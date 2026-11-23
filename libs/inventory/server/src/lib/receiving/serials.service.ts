import { Injectable } from '@nestjs/common';
import {
  normalizeSerial,
  SERIAL_LABELS_MAX,
  type SerialDto,
  type SerialLabelRequest,
  type SerialPage,
  type SerialQuery,
  type SerialRow,
} from '@dax/inventory-contract';
import { pageMeta, pageWindow } from '@dax/contracts';
import { AuditService } from '@dax/platform-core';
import { type Prisma, PrismaService } from '@dax/platform-db';
import { conflict, MODULE_KEY, notFound } from '../common';
import { type SerialLabel, renderSerialLabels } from '../serial-labels';
import { qtyString } from '../stock-math';

const ROW_SELECT = {
  id: true,
  serial: true,
  source: true,
  docType: true,
  docId: true,
  docLineId: true,
  docNumber: true,
  bin: { select: { id: true, code: true } },
  lineNo: true,
  unitNo: true,
  qty: true,
  condition: true,
  status: true,
  voidedAt: true,
  receivedAt: true,
  supplierName: true,
  printCount: true,
  lastPrintedAt: true,
  itemId: true,
} as const;

type Row = Prisma.ItemSerialGetPayload<{ select: typeof ROW_SELECT }>;

const ITEM_SELECT = {
  id: true,
  partNo: true,
  description: true,
  uom: true,
  brand: { select: { name: true } },
} as const;

@Injectable()
export class SerialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** How many serials share each line and condition, for "2 of 3". */
  private async lineCounts(rows: readonly Row[]): Promise<Map<string, number>> {
    const lines = [...new Set(rows.map((r) => r.docLineId).filter(Boolean))];
    if (lines.length === 0) return new Map();
    const counts = await this.prisma.itemSerial.groupBy({
      by: ['docLineId', 'source'],
      where: { docLineId: { in: lines as string[] } },
      _count: { _all: true },
    });
    return new Map(
      counts.map((c) => [`${c.docLineId}|${c.source}`, c._count._all]),
    );
  }

  private toRow(r: Row, counts: Map<string, number>): SerialRow {
    return {
      id: r.id,
      serial: r.serial,
      source: r.source,
      doc: {
        type: r.docType,
        id: r.docId,
        lineId: r.docLineId,
        number: r.docNumber,
      },
      bin: r.bin,
      lineNo: r.lineNo,
      unitNo: r.unitNo,
      unitsOnLine: counts.get(`${r.docLineId}|${r.source}`) ?? 1,
      qty: qtyString(r.qty),
      condition: r.condition,
      status: r.status,
      voidedAt: r.voidedAt?.toISOString() ?? null,
      receivedAt: r.receivedAt.toISOString(),
      supplierName: r.supplierName,
      printCount: r.printCount,
      lastPrintedAt: r.lastPrintedAt?.toISOString() ?? null,
    };
  }

  async bySerial(raw: string): Promise<SerialDto> {
    const row = await this.prisma.itemSerial.findUnique({
      where: { serial: normalizeSerial(raw) },
      select: { ...ROW_SELECT, item: { select: ITEM_SELECT } },
    });
    if (!row) notFound('No part has that serial number.');
    const counts = await this.lineCounts([row]);
    return {
      ...this.toRow(row, counts),
      item: {
        id: row.item.id,
        partNo: row.item.partNo,
        brand: row.item.brand.name,
        description: row.item.description,
        uom: row.item.uom,
      },
    };
  }

  async forItem(itemId: string, query: SerialQuery): Promise<SerialPage> {
    const exists = await this.prisma.item.count({ where: { id: itemId } });
    if (!exists) notFound('Item not found.');
    const where: Prisma.ItemSerialWhereInput = {
      itemId,
      ...(query.status === 'ALL' ? {} : { status: query.status }),
      ...(query.unprinted === 'true' ? { printCount: 0 } : {}),
    };
    const [rows, total, unprinted] = await Promise.all([
      this.prisma.itemSerial.findMany({
        where,
        select: ROW_SELECT,
        orderBy: [{ receivedAt: 'desc' }, { unitNo: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.itemSerial.count({ where }),
      this.prisma.itemSerial.count({
        where: { itemId, status: 'ACTIVE', printCount: 0 },
      }),
    ]);
    const counts = await this.lineCounts(rows);
    return {
      items: rows.map((r) => this.toRow(r, counts)),
      ...pageMeta(query, total),
      unprinted,
    };
  }

  private scope(input: SerialLabelRequest): Prisma.ItemSerialWhereInput {
    const base: Prisma.ItemSerialWhereInput = {
      status: 'ACTIVE',
      ...(input.unprinted ? { printCount: 0 } : {}),
    };
    if (input.serialIds?.length)
      return { ...base, id: { in: input.serialIds } };
    if (input.grnId) {
      return {
        ...base,
        docType: 'GRN',
        docId: input.grnId,
        ...(input.grnLineId ? { docLineId: input.grnLineId } : {}),
      };
    }
    if (input.itemId) return { ...base, itemId: input.itemId };
    if (input.binIds?.length) return { ...base, binId: { in: input.binIds } };
    return { ...base, bin: { zoneId: input.zoneId } };
  }

  /** Label sheet PDF for the chosen serials; counts each as printed. */
  async labels(input: SerialLabelRequest): Promise<Buffer> {
    const where = this.scope(input);
    const total = await this.prisma.itemSerial.count({ where });
    if (total === 0) {
      conflict('NO_SERIALS', 'There are no serial labels to print here.');
    }
    if (total > SERIAL_LABELS_MAX) {
      conflict(
        'TOO_MANY_LABELS',
        `That is ${total} labels. Print at most ${SERIAL_LABELS_MAX} at a time: choose a bin or a part.`,
      );
    }
    const rows = await this.prisma.itemSerial.findMany({
      where,
      select: { ...ROW_SELECT, item: { select: ITEM_SELECT } },
      orderBy: [
        { bin: { code: 'asc' } },
        { item: { partNo: 'asc' } },
        { receivedAt: 'asc' },
        { unitNo: 'asc' },
      ],
    });
    const counts = await this.lineCounts(rows);
    const labels: SerialLabel[] = rows.map((r) => {
      const of = counts.get(`${r.docLineId}|${r.source}`) ?? 1;
      const unit = of > 1 ? ` · ${r.unitNo} of ${of}` : '';
      const qty = r.qty.equals(1) ? '' : ` · ${qtyString(r.qty)} ${r.item.uom}`;
      return {
        serial: r.serial,
        partNo: r.item.partNo,
        brand: r.item.brand.name,
        description: r.item.description,
        footer: `${r.docNumber ?? 'Existing stock'}${unit}${qty}`,
        damaged: r.condition === 'DAMAGED',
      };
    });
    const pdf = await renderSerialLabels(labels, input.skip);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.itemSerial.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { printCount: { increment: 1 }, lastPrintedAt: now },
      });
      await this.audit.record(
        {
          moduleKey: MODULE_KEY,
          entityKey: 'inventory.item_serial',
          action: 'serials_printed',
          after: {
            count: rows.length,
            reprinted: rows.filter((r) => r.printCount > 0).length,
            scope: {
              grnId: input.grnId ?? null,
              grnLineId: input.grnLineId ?? null,
              itemId: input.itemId ?? null,
              zoneId: input.zoneId ?? null,
              bins: input.binIds?.length ?? 0,
              serials: input.serialIds?.length ?? 0,
              unprinted: input.unprinted,
            },
          },
        },
        tx,
      );
    });
    return pdf;
  }
}
