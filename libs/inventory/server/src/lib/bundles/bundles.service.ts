import { Injectable } from '@nestjs/common';
import type {
  BundleDto,
  BundleInput,
  BundlePage,
  BundleQuery,
  BundleUpdate,
} from '@dax/inventory-contract';
import { pageMeta, pageWindow } from '@dax/contracts';
import { AuditService } from '@dax/platform-core';
import { type Prisma, PrismaService } from '@dax/platform-db';
import { conflict, isUniqueViolation, notFound, stale } from '../common';
import {
  auditEntry,
  checkQty,
  ITEM_REF_SELECT,
  loadItems,
  requireItem,
  toItemRef,
} from '../receiving/shared';
import { qtyString } from '../stock-math';

export const BUNDLE_KEY = 'inventory.bundle';

const DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  active: true,
  version: true,
  lines: {
    select: { qty: true, item: { select: ITEM_REF_SELECT } },
    orderBy: { lineNo: 'asc' },
  },
} as const;

type DetailRow = Prisma.BundleGetPayload<{ select: typeof DETAIL_SELECT }>;

function toDto(row: DetailRow): BundleDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    partCount: row.lines.length,
    version: row.version,
    lines: row.lines.map((l) => ({
      item: toItemRef(l.item),
      qty: qtyString(l.qty),
    })),
  };
}

function nameTaken(): never {
  conflict('BUNDLE_EXISTS', 'A bundle with that name already exists.');
}

/** Checks a bundle's parts: active items, whole quantities where needed, no repeats. */
export async function checkBundleLines(
  db: Prisma.TransactionClient | PrismaService,
  lines: readonly { itemId: string; qty: string }[],
  field = 'lines',
): Promise<void> {
  const items = await loadItems(
    db,
    lines.map((l) => l.itemId),
  );
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const item = requireItem(
      items,
      line.itemId,
      `${field}.${i}.itemId`,
      'bundle',
    );
    if (seen.has(line.itemId)) {
      conflict(
        'DUPLICATE_PART',
        `${item.partNo} is listed twice. Put the whole quantity on one line.`,
      );
    }
    seen.add(line.itemId);
    checkQty(item, line.qty, `${field}.${i}.qty`);
  });
}

@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: BundleQuery): Promise<BundlePage> {
    const q = query.q?.trim();
    const where: Prisma.BundleWhereInput = {
      AND: [
        query.status === 'ALL' ? {} : { active: query.status === 'ACTIVE' },
        q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                {
                  lines: {
                    some: {
                      item: { partNo: { contains: q, mode: 'insensitive' } },
                    },
                  },
                },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.bundle.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          active: true,
          _count: { select: { lines: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.bundle.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, ...r }) => ({
        ...r,
        partCount: _count.lines,
      })),
      ...pageMeta(query, total),
    };
  }

  async detail(id: string): Promise<BundleDto> {
    const row = await this.prisma.bundle.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!row) notFound('Bundle not found.');
    return toDto(row);
  }

  async create(actorId: string, input: BundleInput): Promise<BundleDto> {
    await checkBundleLines(this.prisma, input.lines);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bundle.create({
          data: {
            name: input.name,
            description: input.description ?? null,
            createdBy: actorId,
            updatedBy: actorId,
            lines: {
              create: input.lines.map((l, i) => ({
                lineNo: i + 1,
                itemId: l.itemId,
                qty: l.qty,
              })),
            },
          },
          select: { id: true },
        });
        await this.audit.record(
          auditEntry(BUNDLE_KEY, created.id, 'create', {
            name: input.name,
            lines: input.lines,
          }),
          tx,
        );
        return created.id;
      });
      return this.detail(id);
    } catch (error) {
      if (isUniqueViolation(error)) nameTaken();
      throw error;
    }
  }

  async update(
    actorId: string,
    id: string,
    input: BundleUpdate,
  ): Promise<BundleDto> {
    const before = await this.detail(id);
    await checkBundleLines(this.prisma, input.lines);
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.bundle.updateMany({
          where: { id, version: input.version },
          data: {
            name: input.name,
            description: input.description ?? null,
            version: { increment: 1 },
            updatedBy: actorId,
          },
        });
        if (claimed.count === 0) stale();
        await tx.bundleLine.deleteMany({ where: { bundleId: id } });
        await tx.bundleLine.createMany({
          data: input.lines.map((l, i) => ({
            bundleId: id,
            lineNo: i + 1,
            itemId: l.itemId,
            qty: l.qty,
          })),
        });
        await this.audit.record(
          auditEntry(
            BUNDLE_KEY,
            id,
            'update',
            { name: input.name, lines: input.lines },
            {
              before: {
                name: before.name,
                lines: before.lines.map((l) => ({
                  itemId: l.item.id,
                  qty: l.qty,
                })),
              },
            },
          ),
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) nameTaken();
      throw error;
    }
    return this.detail(id);
  }

  async setActive(
    actorId: string,
    id: string,
    input: { version: number; active: boolean },
  ): Promise<BundleDto> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.bundle.updateMany({
        where: { id, version: input.version },
        data: {
          active: input.active,
          version: { increment: 1 },
          updatedBy: actorId,
        },
      });
      if (claimed.count === 0) {
        if (!(await tx.bundle.count({ where: { id } })))
          notFound('Bundle not found.');
        stale();
      }
      await this.audit.record(
        auditEntry(BUNDLE_KEY, id, input.active ? 'restored' : 'archived', {
          active: input.active,
        }),
        tx,
      );
    });
    return this.detail(id);
  }
}
