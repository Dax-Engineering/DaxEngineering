import { pageMeta, pageWindow } from '@dax/contracts';
import {
  ForbiddenException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  AodCreate,
  AodDto,
  AodPage,
  AodQuery,
  AodReject,
  AodUpdate,
} from '@dax/inventory-contract';
import {
  AttachmentAccessRegistry,
  AuditService,
  can,
  EventBus,
  InboxService,
  NumberingService,
  type Policy,
} from '@dax/platform-core';
import {
  type Prisma,
  PrismaService,
  type TransactionClient,
} from '@dax/platform-db';
import { conflict, invalid, MODULE_KEY, notFound, stale } from '../common';
import { MainStore } from '../main-store.service';
import {
  auditEntry,
  type Db,
  ITEM_REF_SELECT,
  stampOf,
  toItemRef,
  userNames,
} from '../receiving/shared';
import { dec, qtyString } from '../stock-math';
import { stockIssued } from '../stock/events';
import { StockPostingService } from '../stock/stock-posting.service';
import { type AodCopy, type AodPrint, renderAod } from './aod-pdf';
import { ensureCustomerBundle, ensureCustomerParts } from './customer-parts';
import {
  MrnsService,
  reservationsByItem,
  reservationsOf,
} from './mrns.service';
import {
  AOD_ALLOWED_FROM,
  type AodAction,
  type AodStatus,
  aodTypeLabel,
  assertAodAction,
  assertMrnAction,
  MRN_ALLOWED_FROM,
  OPEN_AOD_STATUSES,
  overReserved,
  statusAfterIssue,
  suggestBin,
  UNISSUED_AOD_STATUSES,
} from './rules';
import {
  AOD_APPROVE,
  AOD_KEY,
  aodScope,
  canApproveFor,
  customerRef,
  errorCode,
  lockMrn,
  MRN_KEY,
  seesMrnCustomer,
} from './shared';

const SUMMARY_SELECT = {
  id: true,
  number: true,
  type: true,
  status: true,
  createdAt: true,
  issuedAt: true,
  mrn: {
    select: {
      id: true,
      number: true,
      departmentId: true,
      departmentName: true,
      customerId: true,
      customerName: true,
      jobNumber: true,
    },
  },
  _count: { select: { lines: true } },
} as const;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  deliverTo: true,
  vehicleNo: true,
  notes: true,
  submittedBy: true,
  submittedAt: true,
  approvedBy: true,
  approvedAt: true,
  rejectedBy: true,
  rejectedAt: true,
  rejectReason: true,
  issuedBy: true,
  signedBy: true,
  signedAt: true,
  signedFile: true,
  version: true,
  lines: {
    select: {
      id: true,
      mrnLineId: true,
      qty: true,
      scanned: true,
      customerPartNo: true,
      item: { select: ITEM_REF_SELECT },
      mrnLine: {
        select: {
          item: { select: ITEM_REF_SELECT },
          qtyPerSet: true,
          mrnBundle: { select: { id: true, name: true, customerPartNo: true } },
        },
      },
      bin: { select: { id: true, code: true } },
    },
    orderBy: { id: 'asc' },
  },
} as const;

type SummaryRow = Prisma.AodGetPayload<{ select: typeof SUMMARY_SELECT }>;
type DetailRow = Prisma.AodGetPayload<{ select: typeof DETAIL_SELECT }>;

function toSummary(row: SummaryRow, seesCustomer: boolean) {
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    mrn: { id: row.mrn.id, number: row.mrn.number },
    department: { id: row.mrn.departmentId, name: row.mrn.departmentName },
    ...customerRef(seesCustomer, row.mrn),
    lineCount: row._count.lines,
    createdAt: row.createdAt.toISOString(),
    issuedAt: row.issuedAt?.toISOString() ?? null,
  };
}

const INBOX_KIND = 'inventory.aod_approval';

function approvalKey(id: string, submittedAt: Date): string {
  return `aod_approval:${id}:${submittedAt.getTime()}`;
}

function aodPath(id: string): string {
  return `/inventory/issuing/aods/${id}`;
}

function forbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

type AodBundleLine = {
  qty: Prisma.Decimal | string;
  mrnLine: {
    qtyPerSet: Prisma.Decimal | null;
    mrnBundle: {
      id: string;
      name: string;
      customerPartNo: string | null;
    } | null;
  };
};

/** Bundles on an AOD with the whole sets each carries. */
function aodBundles(lines: readonly AodBundleLine[]) {
  const out = new Map<
    string,
    { id: string; name: string; customerPartNo: string | null; sets: number }
  >();
  const perPart = new Map<string, { bundleId: string; sets: Prisma.Decimal }>();
  for (const l of lines) {
    const b = l.mrnLine.mrnBundle;
    if (!b || !l.mrnLine.qtyPerSet) continue;
    if (!out.has(b.id)) {
      out.set(b.id, {
        id: b.id,
        name: b.name,
        customerPartNo: b.customerPartNo,
        sets: 0,
      });
    }
    const key = `${b.id}|${l.mrnLine.qtyPerSet.toString()}`;
    const now = perPart.get(key)?.sets ?? dec(0);
    perPart.set(key, {
      bundleId: b.id,
      sets: now.plus(dec(l.qty).div(dec(l.mrnLine.qtyPerSet))),
    });
  }
  for (const { bundleId, sets } of perPart.values()) {
    const b = out.get(bundleId);
    if (b) b.sets = Math.max(b.sets, Math.round(sets.toNumber()));
  }
  return [...out.values()];
}

/** Every bundle on the MRN must be picked in the same whole number of sets for each of its parts. */
async function assertWholeSets(
  db: Db,
  mrnId: string,
  picks: readonly { mrnLineId: string; qty: Prisma.Decimal | string }[],
): Promise<void> {
  const parts = await db.mrnLine.findMany({
    where: { mrnId, mrnBundleId: { not: null } },
    select: {
      id: true,
      qtyPerSet: true,
      item: { select: { partNo: true } },
      mrnBundle: { select: { id: true, name: true } },
    },
  });
  const picked = new Map<string, Prisma.Decimal>();
  for (const p of picks) {
    picked.set(
      p.mrnLineId,
      (picked.get(p.mrnLineId) ?? dec(0)).plus(dec(p.qty)),
    );
  }
  const byBundle = new Map<string, typeof parts>();
  for (const part of parts) {
    if (!part.mrnBundle) continue;
    byBundle.set(part.mrnBundle.id, [
      ...(byBundle.get(part.mrnBundle.id) ?? []),
      part,
    ]);
  }
  for (const group of byBundle.values()) {
    const sets = group.map((g) =>
      (picked.get(g.id) ?? dec(0)).div(dec(g.qtyPerSet ?? 1)),
    );
    const first = sets[0] ?? dec(0);
    const whole = sets.every((n) => n.isInteger() && n.equals(first));
    if (!whole) {
      const name = group[0]?.mrnBundle?.name ?? 'the bundle';
      const recipe = group
        .map((g) => `${qtyString(g.qtyPerSet ?? 0)} × ${g.item.partNo}`)
        .join(', ');
      conflict(
        'BUNDLE_INCOMPLETE',
        `Pick whole sets of ${name}: each set needs ${recipe}.`,
      );
    }
  }
}

async function storageBins(db: Db, storeId: string, ids: readonly string[]) {
  const rows = await db.bin.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, storeId: true, kind: true, active: true },
  });
  return new Set(
    rows
      .filter((b) => b.storeId === storeId && b.kind === 'STORAGE' && b.active)
      .map((b) => b.id),
  );
}

@Injectable()
export class AodsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly events: EventBus,
    private readonly stock: StockPostingService,
    private readonly store: MainStore,
    private readonly mrns: MrnsService,
    private readonly attachments: AttachmentAccessRegistry,
    private readonly inbox: InboxService,
  ) {}

  onModuleInit(): void {
    this.attachments.register(AOD_KEY, {
      moduleKey: MODULE_KEY,
      canView: async (policy, id, tx) =>
        can(policy, 'inventory.aod.view') &&
        (await (tx ?? this.prisma).aod.count({
          where: { id, ...aodScope(policy) },
        })) > 0,
      canAttach: async (policy, id) =>
        can(policy, 'inventory.aod.attach_signed') &&
        (await this.prisma.aod.count({ where: { id, status: 'ISSUED' } })) > 0,
    });
  }

  async list(policy: Policy, query: AodQuery): Promise<AodPage> {
    const seesCustomer = seesMrnCustomer(policy);
    const like = query.q
      ? { contains: query.q, mode: 'insensitive' as const }
      : null;
    const where: Prisma.AodWhereInput = {
      AND: [
        aodScope(policy),
        query.status === 'ALL'
          ? {}
          : query.status === 'OPEN'
            ? { status: { in: OPEN_AOD_STATUSES } }
            : { status: query.status },
        like
          ? {
              OR: [
                { number: like },
                { deliverTo: like },
                ...(seesCustomer
                  ? [
                      { lines: { some: { customerPartNo: like } } },
                      {
                        mrn: {
                          bundles: { some: { customerPartNo: like } },
                        },
                      },
                    ]
                  : []),
                { mrn: { bundles: { some: { name: like } } } },
                { mrn: { number: like } },
                { mrn: { jobNumber: like } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.aod.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.aod.count({ where }),
    ]);
    return {
      items: rows.map((r) => toSummary(r, seesCustomer)),
      ...pageMeta(query, total),
    };
  }

  async detail(policy: Policy, id: string, scoped = true): Promise<AodDto> {
    const row = await this.load(policy, id, scoped);
    const seesCustomer = seesMrnCustomer(policy);
    const [names, reserved] = await Promise.all([
      userNames(this.prisma, [
        row.submittedBy,
        row.approvedBy,
        row.rejectedBy,
        row.issuedBy,
        row.signedBy,
      ]),
      reservationsOf(
        this.prisma,
        row.lines.map((l) => l.mrnLineId),
      ),
    ]);
    return {
      ...toSummary(row, seesMrnCustomer(policy)),
      deliverTo: row.deliverTo,
      vehicleNo: row.vehicleNo,
      notes: row.notes,
      submitted: stampOf(row.submittedBy, row.submittedAt, names),
      approved: stampOf(row.approvedBy, row.approvedAt, names),
      rejected: stampOf(row.rejectedBy, row.rejectedAt, names),
      rejectReason: row.rejectReason,
      canApprove:
        row.status === 'PENDING_APPROVAL' &&
        canApproveFor(policy, row.mrn.departmentId),
      issued: stampOf(row.issuedBy, row.issuedAt, names),
      signed: stampOf(row.signedBy, row.signedAt, names),
      signedFileId: row.signedFile,
      version: row.version,
      lines: row.lines.map((l) => ({
        id: l.id,
        mrnLineId: l.mrnLineId,
        item: toItemRef(l.item),
        bin: l.bin,
        qty: qtyString(l.qty),
        reservedForLine: qtyString(reserved.get(l.mrnLineId) ?? 0),
        scanned: l.scanned,
        customerPartNo: seesCustomer ? l.customerPartNo : null,
        requestedItem:
          l.mrnLine.item.id === l.item.id ? null : toItemRef(l.mrnLine.item),
        bundleId: l.mrnLine.mrnBundle?.id ?? null,
      })),
      bundles: aodBundles(row.lines).map((b) => ({
        ...b,
        customerPartNo: seesMrnCustomer(policy) ? b.customerPartNo : null,
      })),
    };
  }

  private async load(
    policy: Policy,
    id: string,
    scoped: boolean,
  ): Promise<DetailRow> {
    const row = await this.prisma.aod.findFirst({
      where: { id, ...(scoped ? aodScope(policy) : {}) },
      select: DETAIL_SELECT,
    });
    if (!row) notFound('AOD not found.');
    return row;
  }

  async pdf(
    policy: Policy,
    id: string,
    copy: AodCopy = 'dax',
  ): Promise<{ number: string | null; pdf: Buffer }> {
    const row = await this.load(policy, id, true);
    if (
      copy === 'customer' &&
      (!row.mrn.customerId || !seesMrnCustomer(policy))
    ) {
      conflict(
        'NO_CUSTOMER',
        'This AOD has no customer, so there is no customer copy to print.',
      );
    }
    if (row.status !== 'ISSUED' && row.status !== 'SIGNED') {
      conflict(
        'NOT_ISSUED',
        'An AOD can be printed once it has been approved and issued.',
      );
    }
    const names = await userNames(this.prisma, [row.issuedBy]);
    const print: AodPrint = {
      number: row.number,
      typeLabel: aodTypeLabel(row.type),
      date: row.issuedAt ?? new Date(),
      mrnNumber: row.mrn.number,
      department: row.mrn.departmentName,
      customer: seesMrnCustomer(policy) ? (row.mrn.customerName ?? '-') : null,
      jobNumber: row.mrn.jobNumber,
      deliverTo: row.deliverTo,
      vehicleNo: row.vehicleNo,
      notes: row.notes,
      issuedBy: row.issuedBy ? (names.get(row.issuedBy) ?? null) : null,
      lines: row.lines.map((l) => ({
        partNo: l.item.partNo,
        requestedPartNo:
          l.mrnLine.item.id === l.item.id ? null : l.mrnLine.item.partNo,
        description: l.item.description,
        bin: l.bin?.code ?? null,
        qty: qtyString(l.qty),
        uom: l.item.uom,
        customerPartNo: l.customerPartNo,
        bundleId: l.mrnLine.mrnBundle?.id ?? null,
      })),
      bundles: aodBundles(row.lines),
    };
    const pdf = await renderAod(print, copy);
    await this.audit.record(
      auditEntry(AOD_KEY, id, 'printed', { number: row.number, copy }),
    );
    return { number: row.number, pdf };
  }

  async create(policy: Policy, input: AodCreate): Promise<AodDto> {
    const mrn = await this.prisma.mrn.findUnique({
      where: { id: input.mrnId },
      select: { status: true, customerId: true },
    });
    if (!mrn) notFound('MRN not found.');
    assertMrnAction('pick', mrn.status);
    const storeId = await this.store.id();

    const id = await this.prisma.$transaction(async (tx) => {
      const status = await lockMrn(tx, input.mrnId);
      if (!status) notFound('MRN not found.');
      assertMrnAction('pick', status);
      const unissued = await tx.aod.count({
        where: { mrnId: input.mrnId, status: { in: UNISSUED_AOD_STATUSES } },
      });
      if (unissued > 0) {
        conflict(
          'AOD_IN_PROGRESS',
          'This MRN already has an AOD that is not issued yet. Issue or cancel it first.',
        );
      }
      const lines = await tx.mrnLine.findMany({
        where: { mrnId: input.mrnId },
        select: {
          id: true,
          mrnBundleId: true,
          qtyPerSet: true,
          mrnBundle: { select: { bundleId: true, customerPartNo: true } },
        },
        orderBy: { lineNo: 'asc' },
      });
      const reservedBy = await reservationsByItem(
        tx,
        lines.map((l) => l.id),
      );
      const reservedItems = await tx.item.findMany({
        where: {
          id: {
            in: [...reservedBy.values()].flatMap((m) => [...m.keys()]),
          },
        },
        select: { id: true, familyDepth: true },
      });
      const depthOf = new Map(reservedItems.map((i) => [i.id, i.familyDepth]));
      const lineTotal = (lineId: string) =>
        [...(reservedBy.get(lineId)?.values() ?? [])].reduce(
          (sum, q) => sum.plus(q),
          dec(0),
        );
      // A bundle goes out in whole sets only: as many as every part has reserved.
      const readySets = new Map<string, number>();
      for (const l of lines) {
        if (!l.mrnBundleId || !l.qtyPerSet) continue;
        const sets = Math.floor(
          lineTotal(l.id).div(dec(l.qtyPerSet)).toNumber() + 1e-9,
        );
        readySets.set(
          l.mrnBundleId,
          Math.min(readySets.get(l.mrnBundleId) ?? sets, sets),
        );
      }
      const picks = lines.flatMap((l) => {
        let allow =
          l.mrnBundleId && l.qtyPerSet
            ? dec(l.qtyPerSet).times(readySets.get(l.mrnBundleId) ?? 0)
            : lineTotal(l.id);
        const out: {
          mrnLineId: string;
          itemId: string;
          qty: Prisma.Decimal;
        }[] = [];
        const reserved = [
          ...(reservedBy.get(l.id) ?? new Map<string, Prisma.Decimal>()),
        ].sort(([a], [b]) => (depthOf.get(b) ?? 0) - (depthOf.get(a) ?? 0));
        for (const [itemId, qty] of reserved) {
          if (!allow.gt(0)) break;
          const take = qty.lt(allow) ? qty : allow;
          if (take.gt(0)) out.push({ mrnLineId: l.id, itemId, qty: take });
          allow = allow.minus(take);
        }
        return out;
      });
      if (picks.length === 0) {
        conflict(
          'NOTHING_RESERVED',
          'Nothing is reserved on this MRN yet, or no bundle has a complete set reserved.',
        );
      }
      const pickedItems = await tx.item.findMany({
        where: { id: { in: picks.map((p) => p.itemId) } },
        select: {
          id: true,
          defaultBinId: true,
          familyDepth: true,
          partNo: true,
        },
      });
      const itemInfo = new Map(pickedItems.map((i) => [i.id, i]));
      const lineOrder = new Map(lines.map((l, i) => [l.id, i]));
      picks.sort(
        (a, b) =>
          (lineOrder.get(a.mrnLineId) ?? 0) -
            (lineOrder.get(b.mrnLineId) ?? 0) ||
          (itemInfo.get(b.itemId)?.familyDepth ?? 0) -
            (itemInfo.get(a.itemId)?.familyDepth ?? 0),
      );
      const stock = await tx.binStock.findMany({
        where: {
          itemId: { in: picks.map((p) => p.itemId) },
          qty: { gt: 0 },
          bin: { storeId, kind: 'STORAGE', active: true },
        },
        select: { itemId: true, binId: true, qty: true },
      });
      const customerParts = mrn.customerId
        ? await ensureCustomerParts(
            tx,
            mrn.customerId,
            picks.map((p) => p.itemId),
            policy.userId,
          )
        : new Map<string, string>();
      if (mrn.customerId) {
        const numbered = new Set<string>();
        for (const l of lines) {
          if (!l.mrnBundleId || !l.mrnBundle || numbered.has(l.mrnBundleId))
            continue;
          numbered.add(l.mrnBundleId);
          if (l.mrnBundle.customerPartNo) continue;
          if (!(readySets.get(l.mrnBundleId) ?? 0)) continue;
          const partNo = await ensureCustomerBundle(
            tx,
            mrn.customerId,
            l.mrnBundle.bundleId,
            policy.userId,
          );
          await tx.mrnBundle.update({
            where: { id: l.mrnBundleId },
            data: { customerPartNo: partNo },
          });
        }
      }
      const created = await tx.aod.create({
        data: {
          mrnId: input.mrnId,
          type: input.type,
          deliverTo: input.deliverTo ?? null,
          vehicleNo: input.vehicleNo ?? null,
          notes: input.notes ?? null,
          createdBy: policy.userId,
          updatedBy: policy.userId,
          lines: {
            create: picks.map((p) => ({
              mrnLineId: p.mrnLineId,
              itemId: p.itemId,
              customerPartNo: customerParts.get(p.itemId) ?? null,
              qty: qtyString(p.qty),
              binId: suggestBin(
                itemInfo.get(p.itemId)?.defaultBinId ?? null,
                stock.filter((s) => s.itemId === p.itemId),
                p.qty,
              ),
            })),
          },
        },
        select: { id: true },
      });
      await this.audit.record(
        auditEntry(AOD_KEY, created.id, 'create', {
          mrnId: input.mrnId,
          type: input.type,
          lines: picks.length,
        }),
        tx,
      );
      return created.id;
    });
    return this.detail(policy, id, false);
  }

  async update(policy: Policy, id: string, input: AodUpdate): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: {
        status: true,
        version: true,
        mrnId: true,
        type: true,
        deliverTo: true,
        vehicleNo: true,
        notes: true,
        mrn: { select: { customerId: true } },
        lines: {
          select: {
            id: true,
            mrnLineId: true,
            binId: true,
            qty: true,
            scanned: true,
          },
        },
      },
    });
    if (!before) notFound('AOD not found.');
    this.guard('edit', before, input.version);
    const changes: Record<string, unknown> = {};
    for (const key of ['type', 'deliverTo', 'vehicleNo', 'notes'] as const) {
      if (input[key] !== undefined) changes[key] = input[key];
    }
    const plan = input.lines
      ? await this.planLines(before.mrnId, before.lines, input.lines)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'edit', input.version, policy.userId, changes);
      const customerParts =
        plan && before.mrn.customerId
          ? await ensureCustomerParts(
              tx,
              before.mrn.customerId,
              plan.map((p) => p.itemId),
              policy.userId,
            )
          : new Map<string, string>();
      if (plan) {
        const kept = new Set(plan.flatMap((p) => (p.id ? [p.id] : [])));
        const dropped = before.lines
          .filter((l) => !kept.has(l.id))
          .map((l) => l.id);
        if (dropped.length > 0) {
          await tx.aodLine.deleteMany({ where: { id: { in: dropped } } });
        }
        const fresh: Prisma.AodLineCreateManyInput[] = [];
        for (const p of plan) {
          const data = {
            mrnLineId: p.mrnLineId,
            itemId: p.itemId,
            binId: p.binId,
            qty: p.qty,
            scanned: p.scanned,
            customerPartNo: customerParts.get(p.itemId) ?? null,
          };
          if (p.id) await tx.aodLine.update({ where: { id: p.id }, data });
          else fresh.push({ ...data, aodId: id });
        }
        if (fresh.length > 0) await tx.aodLine.createMany({ data: fresh });
      }
      const beforeValues: Record<string, unknown> = {};
      for (const key of Object.keys(changes)) {
        beforeValues[key] = before[key as keyof typeof before];
      }
      const afterValues: Record<string, unknown> = { ...changes };
      if (plan) {
        beforeValues['lines'] = before.lines.map((l) => ({
          mrnLineId: l.mrnLineId,
          binId: l.binId,
          qty: qtyString(l.qty),
          scanned: l.scanned,
        }));
        afterValues['lines'] = plan.map(
          ({ mrnLineId, binId, qty, scanned }) => ({
            mrnLineId,
            binId,
            qty,
            scanned,
          }),
        );
      }
      await this.audit.record(
        auditEntry(AOD_KEY, id, 'update', afterValues, {
          before: beforeValues,
        }),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  private async planLines(
    mrnId: string,
    existing: readonly { id: string }[],
    inputs: NonNullable<AodUpdate['lines']>,
  ) {
    const storeId = await this.store.id();
    const mrnLines = new Map(
      (
        await this.prisma.mrnLine.findMany({
          where: { mrnId },
          select: {
            id: true,
            itemId: true,
            item: {
              select: { partNo: true, allowFraction: true, familyId: true },
            },
          },
        })
      ).map((l) => [l.id, l]),
    );
    const picked = new Map(
      (
        await this.prisma.item.findMany({
          where: {
            id: {
              in: inputs.flatMap((l) => (l.itemId ? [l.itemId] : [])),
            },
          },
          select: {
            id: true,
            partNo: true,
            allowFraction: true,
            familyId: true,
          },
        })
      ).map((i) => [i.id, i]),
    );
    const current = new Set(existing.map((l) => l.id));
    const binIds = inputs.flatMap((l) => (l.binId ? [l.binId] : []));
    const okBins = await storageBins(this.prisma, storeId, binIds);
    const seen = new Set<string>();
    const plan = inputs.map((line, i) => {
      const field = (name: string) => `lines.${i}.${name}`;
      if (line.id && (!current.has(line.id) || seen.has(line.id))) {
        invalid('That line is not on this AOD.', [field('id')]);
      }
      if (line.id) seen.add(line.id);
      const mrnLine = mrnLines.get(line.mrnLineId);
      if (!mrnLine)
        invalid('That line is not on the MRN.', [field('mrnLineId')]);
      if (line.binId && !okBins.has(line.binId)) {
        invalid('Pick from an active storage bin.', [field('binId')]);
      }
      const item = line.itemId
        ? picked.get(line.itemId)
        : { id: mrnLine.itemId, ...mrnLine.item };
      if (!item || item.familyId !== mrnLine.item.familyId) {
        invalid(
          `That part is not ${mrnLine.item.partNo} or a number it supersedes.`,
          [field('itemId')],
        );
      }
      if (!item.allowFraction && !dec(line.qty).isInteger()) {
        invalid(`${item.partNo} is counted in whole units.`, [field('qty')]);
      }
      return {
        id: line.id ?? null,
        mrnLineId: line.mrnLineId,
        itemId: item.id,
        partNo: item.partNo,
        binId: line.binId,
        qty: qtyString(line.qty),
        scanned: line.scanned,
      };
    });
    const reservedBy = await reservationsByItem(this.prisma, [
      ...mrnLines.keys(),
    ]);
    const key = (mrnLineId: string, itemId: string) => `${mrnLineId}:${itemId}`;
    const reserved = new Map<string, Prisma.Decimal>();
    for (const [lineId, byItem] of reservedBy) {
      for (const [itemId, qty] of byItem)
        reserved.set(key(lineId, itemId), qty);
    }
    await assertWholeSets(
      this.prisma,
      mrnId,
      plan.map((p) => ({ mrnLineId: p.mrnLineId, qty: p.qty })),
    );
    const over = overReserved(
      plan.map((p) => ({ mrnLineId: key(p.mrnLineId, p.itemId), qty: p.qty })),
      reserved,
    );
    if (over) {
      const p = plan.find((x) => key(x.mrnLineId, x.itemId) === over);
      conflict(
        'MORE_THAN_RESERVED',
        `Only ${qtyString(reserved.get(over) ?? 0)} of ${p?.partNo ?? 'this item'} is reserved for this MRN.`,
      );
    }
    return plan;
  }

  async issue(policy: Policy, id: string, version: number): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: { status: true, version: true, mrnId: true, type: true },
    });
    if (!before) notFound('AOD not found.');
    this.guard('issue', before, version);
    const storeId = await this.store.id();

    await this.prisma.$transaction(async (tx) => {
      const mrnClaim = await tx.mrn.updateMany({
        where: { id: before.mrnId, status: { in: MRN_ALLOWED_FROM.issue } },
        data: { version: { increment: 1 }, updatedBy: policy.userId },
      });
      if (mrnClaim.count === 0) {
        conflict('INVALID_STATE', 'This MRN is no longer open for issuing.');
      }
      await this.claim(tx, id, 'issue', version, policy.userId, {});
      const lines = await tx.aodLine.findMany({
        where: { aodId: id },
        select: {
          id: true,
          mrnLineId: true,
          itemId: true,
          binId: true,
          qty: true,
          item: { select: { partNo: true } },
        },
      });
      if (lines.length === 0)
        invalid('Add at least one line before issuing.', ['lines']);
      await assertWholeSets(tx, before.mrnId, lines);
      await this.numberCustomerParts(tx, id, before.mrnId, policy.userId);
      const okBins = await storageBins(
        tx,
        storeId,
        lines.flatMap((l) => (l.binId ? [l.binId] : [])),
      );
      const picks = lines.map((l) => {
        if (!l.binId || !okBins.has(l.binId)) {
          invalid(`Choose an active storage bin for ${l.item.partNo}.`, [
            'lines',
          ]);
        }
        return { ...l, binId: l.binId };
      });

      const now = new Date();
      const { number } = await this.numbering.next(tx, {
        docType: 'AOD',
        subtype: before.type,
        date: now,
      });
      await tx.aod.update({
        where: { id },
        data: {
          status: 'ISSUED',
          number,
          issuedBy: policy.userId,
          issuedAt: now,
        },
      });
      const ordered = [...picks].sort((a, b) =>
        a.itemId === b.itemId
          ? a.binId.localeCompare(b.binId)
          : a.itemId.localeCompare(b.itemId),
      );
      for (const pick of ordered) {
        try {
          await this.stock.issueReserved(
            tx,
            {
              itemId: pick.itemId,
              binId: pick.binId,
              qty: pick.qty,
              mrnLineId: pick.mrnLineId,
              docType: 'AOD',
              docId: id,
              docLineId: pick.id,
              docNumber: number,
            },
            policy.userId,
          );
        } catch (error) {
          if (errorCode(error) === 'NOT_RESERVED') {
            conflict(
              'NOT_RESERVED',
              `More of ${pick.item.partNo} is being issued than is reserved for this MRN.`,
            );
          }
          throw error;
        }
      }
      const issued = new Map<string, Prisma.Decimal>();
      for (const p of picks) {
        issued.set(
          p.mrnLineId,
          (issued.get(p.mrnLineId) ?? dec(0)).plus(dec(p.qty)),
        );
      }
      for (const [mrnLineId, qty] of issued) {
        await tx.mrnLine.update({
          where: { id: mrnLineId },
          data: { qtyIssued: { increment: qtyString(qty) } },
        });
      }
      const mrnLines = await tx.mrnLine.findMany({
        where: { mrnId: before.mrnId },
        select: { qtyRequested: true, qtyIssued: true, qtyShortClosed: true },
      });
      const mrnStatus = statusAfterIssue(mrnLines);
      await tx.mrn.update({
        where: { id: before.mrnId },
        data: { status: mrnStatus },
      });

      await this.events.publish(tx, stockIssued, {
        aodId: id,
        number,
        mrnId: before.mrnId,
        lines: picks.map((p) => ({
          itemId: p.itemId,
          binId: p.binId,
          qty: qtyString(p.qty),
        })),
      });
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'issued',
          {
            status: 'ISSUED',
            number,
            lines: picks.map((p) => ({
              itemId: p.itemId,
              binId: p.binId,
              qty: qtyString(p.qty),
            })),
          },
          { before: { status: 'APPROVED' } },
        ),
        tx,
      );
      await this.audit.record(
        auditEntry(MRN_KEY, before.mrnId, 'issued', {
          status: mrnStatus,
          aod: number,
        }),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  async cancel(policy: Policy, id: string, version: number): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: { status: true, version: true, submittedAt: true },
    });
    if (!before) notFound('AOD not found.');
    this.guard('cancel', before, version);
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'cancel', version, policy.userId, {
        status: 'CANCELLED',
      });
      if (before.status === 'PENDING_APPROVAL' && before.submittedAt) {
        await this.inbox.close(tx, approvalKey(id, before.submittedAt));
      }
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'cancelled',
          { status: 'CANCELLED' },
          { before: { status: before.status } },
        ),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  /** Stores sends a picked AOD to its department's approvers. */
  async submit(policy: Policy, id: string, version: number): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: {
        status: true,
        version: true,
        type: true,
        mrn: {
          select: { number: true, departmentId: true, departmentName: true },
        },
        lines: { select: { binId: true, item: { select: { partNo: true } } } },
      },
    });
    if (!before) notFound('AOD not found.');
    this.guard('submit', before, version);
    if (before.lines.length === 0) {
      invalid('Add at least one line before sending it for approval.', [
        'lines',
      ]);
    }
    const okBins = await storageBins(
      this.prisma,
      await this.store.id(),
      before.lines.flatMap((l) => (l.binId ? [l.binId] : [])),
    );
    for (const line of before.lines) {
      if (!line.binId || !okBins.has(line.binId)) {
        invalid(`Choose an active storage bin for ${line.item.partNo}.`, [
          'lines',
        ]);
      }
    }
    const approvers = (
      await this.inbox.recipients(AOD_APPROVE, {
        departmentId: before.mrn.departmentId,
      })
    ).filter((r) => r.userId !== policy.userId);
    const lineCount = before.lines.length;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'submit', version, policy.userId, {
        status: 'PENDING_APPROVAL',
        submittedBy: policy.userId,
        submittedAt: now,
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
      });
      await this.inbox.deliver(tx, {
        userIds: approvers.map((a) => a.userId),
        kind: INBOX_KIND,
        title: `AOD for ${before.mrn.number ?? 'an MRN'} needs your approval`,
        body: `${before.mrn.departmentName} · ${aodTypeLabel(before.type)} · ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}. Stores can issue and print it once you approve.`,
        link: aodPath(id),
        sourceKey: approvalKey(id, now),
      });
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'submitted',
          { status: 'PENDING_APPROVAL', approvers: approvers.length },
          { before: { status: 'PICKING' } },
        ),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  /** Stores takes an AOD back from approval to change it. */
  async withdraw(policy: Policy, id: string, version: number): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: { status: true, version: true, submittedAt: true },
    });
    if (!before) notFound('AOD not found.');
    this.guard('withdraw', before, version);
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'withdraw', version, policy.userId, {
        status: 'PICKING',
        submittedBy: null,
        submittedAt: null,
      });
      if (before.submittedAt) {
        await this.inbox.close(tx, approvalKey(id, before.submittedAt));
      }
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'withdrawn',
          { status: 'PICKING' },
          { before: { status: 'PENDING_APPROVAL' } },
        ),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  async approve(policy: Policy, id: string, version: number): Promise<AodDto> {
    const before = await this.decisionTarget(policy, id, 'approve', version);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'approve', version, policy.userId, {
        status: 'APPROVED',
        approvedBy: policy.userId,
        approvedAt: now,
      });
      await this.inbox.close(tx, approvalKey(id, before.submittedAt), now);
      await this.inbox.deliver(tx, {
        userIds:
          before.submittedBy === policy.userId ? [] : [before.submittedBy],
        kind: INBOX_KIND,
        title: `AOD for ${before.mrnNumber} is approved`,
        body: `Approved for ${before.departmentName}. Issue it, then print it.`,
        link: aodPath(id),
        sourceKey: `aod_decision:${id}:${now.getTime()}`,
      });
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'approved',
          { status: 'APPROVED' },
          { before: { status: 'PENDING_APPROVAL' } },
        ),
        tx,
      );
    });
    return this.detail(policy, id);
  }

  async reject(policy: Policy, id: string, input: AodReject): Promise<AodDto> {
    const before = await this.decisionTarget(
      policy,
      id,
      'reject',
      input.version,
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, id, 'reject', input.version, policy.userId, {
        status: 'PICKING',
        submittedBy: null,
        submittedAt: null,
        rejectedBy: policy.userId,
        rejectedAt: now,
        rejectReason: input.reason,
      });
      await this.inbox.close(tx, approvalKey(id, before.submittedAt), now);
      await this.inbox.deliver(tx, {
        userIds:
          before.submittedBy === policy.userId ? [] : [before.submittedBy],
        kind: INBOX_KIND,
        title: `AOD for ${before.mrnNumber} was rejected`,
        body: `${before.departmentName}: ${input.reason}`,
        link: aodPath(id),
        sourceKey: `aod_decision:${id}:${now.getTime()}`,
      });
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'rejected',
          { status: 'PICKING' },
          { before: { status: 'PENDING_APPROVAL' }, reason: input.reason },
        ),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  private async decisionTarget(
    policy: Policy,
    id: string,
    action: 'approve' | 'reject',
    version: number,
  ) {
    const row = await this.prisma.aod.findFirst({
      where: { id, ...aodScope(policy) },
      select: {
        status: true,
        version: true,
        submittedBy: true,
        submittedAt: true,
        mrn: {
          select: { number: true, departmentId: true, departmentName: true },
        },
      },
    });
    if (!row) notFound('AOD not found.');
    this.guard(action, row, version);
    if (!canApproveFor(policy, row.mrn.departmentId)) {
      forbidden(
        'OUT_OF_SCOPE',
        'This AOD is for a department you do not approve for.',
      );
    }
    if (!row.submittedBy || !row.submittedAt) stale();
    return {
      submittedBy: row.submittedBy,
      submittedAt: row.submittedAt,
      mrnNumber: row.mrn.number ?? 'an MRN',
      departmentName: row.mrn.departmentName,
    };
  }

  async sign(
    policy: Policy,
    id: string,
    input: { version: number; attachmentId: string },
  ): Promise<AodDto> {
    const before = await this.prisma.aod.findUnique({
      where: { id },
      select: { status: true, version: true, mrnId: true },
    });
    if (!before) notFound('AOD not found.');
    this.guard('sign', before, input.version);
    const file = await this.prisma.attachment.findFirst({
      where: {
        id: input.attachmentId,
        entityKey: AOD_KEY,
        entityId: id,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!file)
      invalid('Upload the signed copy to this AOD first.', ['attachmentId']);

    await this.prisma.$transaction(async (tx) => {
      await lockMrn(tx, before.mrnId);
      await this.claim(tx, id, 'sign', input.version, policy.userId, {
        status: 'SIGNED',
        signedFile: file.id,
        signedBy: policy.userId,
        signedAt: new Date(),
      });
      const closed = await this.mrns.closeIfDone(
        tx,
        before.mrnId,
        policy.userId,
      );
      await this.audit.record(
        auditEntry(
          AOD_KEY,
          id,
          'signed',
          { status: 'SIGNED', signedFile: file.id, mrnClosed: closed },
          { before: { status: 'ISSUED' } },
        ),
        tx,
      );
    });
    return this.detail(policy, id, false);
  }

  /** Gives lines on a customer's AOD their customer part number if they lack one. */
  private async numberCustomerParts(
    tx: TransactionClient,
    aodId: string,
    mrnId: string,
    actorId: string,
  ): Promise<void> {
    const mrn = await tx.mrn.findUnique({
      where: { id: mrnId },
      select: { customerId: true },
    });
    if (!mrn?.customerId) return;
    const unnumbered = await tx.aodLine.findMany({
      where: { aodId, customerPartNo: null },
      select: { id: true, itemId: true },
    });
    if (unnumbered.length === 0) return;
    const numbers = await ensureCustomerParts(
      tx,
      mrn.customerId,
      unnumbered.map((l) => l.itemId),
      actorId,
    );
    for (const line of unnumbered) {
      await tx.aodLine.update({
        where: { id: line.id },
        data: { customerPartNo: numbers.get(line.itemId) ?? null },
      });
    }
  }

  private guard(
    action: AodAction,
    row: { status: AodStatus; version: number },
    version: number,
  ): void {
    assertAodAction(action, row.status);
    if (row.version !== version) stale();
  }

  private async claim(
    tx: TransactionClient,
    id: string,
    action: AodAction,
    version: number,
    userId: string,
    data: Prisma.AodUncheckedUpdateManyInput,
  ): Promise<void> {
    const claimed = await tx.aod.updateMany({
      where: { id, version, status: { in: AOD_ALLOWED_FROM[action] } },
      data: { ...data, version: { increment: 1 }, updatedBy: userId },
    });
    if (claimed.count === 0) stale();
  }
}
