import { Injectable } from '@nestjs/common';
import {
  type ItemAge,
  REPORT_CSV_ROW_LIMIT,
  REPORT_ROW_LIMIT,
  type StockAgeQuery,
  type StockAgeReport,
  type StockAgeRow,
  type StockAgeSettingsDto,
  type StockAgeSettingsInput,
  STOCK_AGE_DEFAULT_BANDS,
  stockAgeBand,
  stockAgeBandLabels,
} from '@dax/inventory-contract';
import { pageMeta, pageWindow, type PageParams } from '@dax/contracts';
import { AuditService } from '@dax/platform-core';
import {
  type Prisma,
  PrismaService,
  type TransactionClient,
} from '@dax/platform-db';
import { MODULE_KEY, notFound, stale } from '../common';
import { MainStore } from '../main-store.service';
import { dec, qtyString } from '../stock-math';
import { daysBetween } from '../stock/stock-age';
import { colomboDay, daysOldCutoff, toCsv } from './report-math';
import type { CsvFile } from './reports.service';

type Db = PrismaService | TransactionClient;
const SETTINGS_ID = 1;

export async function ageBands(db: Db): Promise<number[]> {
  const row = await db.stockAgeSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { bands: true },
  });
  return row?.bands.length ? row.bands : [...STOCK_AGE_DEFAULT_BANDS];
}

interface LayerSql {
  item_id: string;
  part_no: string;
  brand: string;
  description: string;
  uom: string;
  aged_from: Date;
  at_least: boolean;
  qty_left: Prisma.Decimal;
}

/** Shelf stock of each part, split into age bands. */
export function bandRows(
  layers: readonly LayerSql[],
  limits: readonly number[],
  now: Date,
): StockAgeRow[] {
  const rows = new Map<
    string,
    {
      first: LayerSql;
      bands: Prisma.Decimal[];
      total: Prisma.Decimal;
      dayQty: Prisma.Decimal;
      oldest: number;
      atLeast: boolean;
    }
  >();
  for (const l of layers) {
    const days = daysBetween(l.aged_from, now);
    const qty = dec(l.qty_left);
    let row = rows.get(l.item_id);
    if (!row) {
      row = {
        first: l,
        bands: Array.from({ length: limits.length + 1 }, () => dec(0)),
        total: dec(0),
        dayQty: dec(0),
        oldest: 0,
        atLeast: false,
      };
      rows.set(l.item_id, row);
    }
    const band = stockAgeBand(days, limits);
    row.bands[band] = (row.bands[band] ?? dec(0)).plus(qty);
    row.total = row.total.plus(qty);
    row.dayQty = row.dayQty.plus(qty.times(days));
    row.oldest = Math.max(row.oldest, days);
    row.atLeast ||= l.at_least;
  }
  return [...rows.values()]
    .map((r) => ({
      item: {
        id: r.first.item_id,
        partNo: r.first.part_no,
        brand: r.first.brand,
        description: r.first.description,
        uom: r.first.uom,
      },
      onShelf: qtyString(r.total),
      bands: r.bands.map((b) => qtyString(b)),
      oldestDays: r.oldest,
      averageDays: r.total.isZero()
        ? 0
        : Math.round(r.dayQty.div(r.total).toNumber()),
      atLeast: r.atLeast,
    }))
    .sort(
      (a, b) =>
        b.oldestDays - a.oldestDays ||
        a.item.partNo.localeCompare(b.item.partNo),
    );
}

@Injectable()
export class StockAgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MainStore,
    private readonly audit: AuditService,
  ) {}

  async report(
    query: StockAgeQuery,
    limit = REPORT_ROW_LIMIT,
    now = new Date(),
  ): Promise<StockAgeReport> {
    const storeId = await this.store.id();
    const limits = await ageBands(this.prisma);
    const like = query.q ? `%${query.q}%` : null;
    const layers = await this.prisma.$queryRaw<LayerSql[]>`
      SELECT l.item_id::text AS item_id, i.part_no, br.name AS brand, i.description, i.uom,
        l.aged_from, l.at_least, l.qty_left
      FROM inventory.stock_layer l
      JOIN inventory.item i ON i.id = l.item_id
      JOIN inventory.brand br ON br.id = i.brand_id
      WHERE l.store_id = ${storeId}::uuid AND l.qty_left > 0
        AND (${like}::text IS NULL OR i.part_no ILIKE ${like} OR i.description ILIKE ${like})`;
    let rows = bandRows(layers, limits, now);
    if (query.band !== undefined) {
      const from = Math.min(query.band, limits.length);
      rows = rows.filter((r) => r.bands.slice(from).some((q) => dec(q).gt(0)));
    }
    return {
      limits,
      items: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
  }

  async csv(query: StockAgeQuery): Promise<CsvFile> {
    const report = await this.report(query, REPORT_CSV_ROW_LIMIT);
    const labels = stockAgeBandLabels(report.limits).map((l) => `${l} days`);
    const rows: (string | number | null)[][] = report.items.map((r) => [
      r.item.partNo,
      r.item.brand,
      r.item.description,
      r.onShelf,
      r.item.uom,
      ...r.bands,
      r.oldestDays,
      r.averageDays,
      r.atLeast ? 'Includes opening stock' : null,
    ]);
    return {
      name: `stock-age-${colomboDay(new Date())}.csv`,
      text: toCsv(
        [
          'Part number',
          'Brand',
          'Description',
          'On shelf',
          'Unit',
          ...labels,
          'Oldest (days)',
          'Average (days)',
          'Note',
        ],
        rows,
      ),
    };
  }

  /** Parts holding shelf stock older than the last band limit, for the Home tile. */
  async agedOver(now = new Date()): Promise<{ count: number; limit: number }> {
    const storeId = await this.store.id();
    const limits = await ageBands(this.prisma);
    const limit = limits[limits.length - 1] ?? 365;
    const before = daysOldCutoff(limit + 1, now);
    const rows = await this.prisma.stockLayer.groupBy({
      by: ['itemId'],
      where: { storeId, qtyLeft: { gt: 0 }, agedFrom: { lt: before } },
    });
    return { count: rows.length, limit };
  }

  async item(id: string, page: PageParams, now = new Date()): Promise<ItemAge> {
    const exists = await this.prisma.item.count({ where: { id } });
    if (!exists) notFound('Item not found.');
    const storeId = await this.store.id();
    const [limits, shelf, out, total] = await Promise.all([
      ageBands(this.prisma),
      this.prisma.stockLayer.findMany({
        where: { storeId, itemId: id, qtyLeft: { gt: 0 } },
        orderBy: [{ agedFrom: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.stockLayerUse.findMany({
        where: { itemId: id },
        orderBy: [{ usedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(page),
      }),
      this.prisma.stockLayerUse.count({ where: { itemId: id } }),
    ]);
    return {
      limits,
      shelf: shelf.map((l) => ({
        id: l.id,
        agedFrom: l.agedFrom.toISOString(),
        days: daysBetween(l.agedFrom, now),
        atLeast: l.atLeast,
        source: l.source,
        doc: { type: l.docType, id: l.docId, number: l.docNumber },
        qtyIn: qtyString(l.qtyIn),
        qtyLeft: qtyString(l.qtyLeft),
      })),
      out: {
        items: out.map((u) => ({
          id: u.id,
          usedAt: u.usedAt.toISOString(),
          movement: u.movement,
          doc: { type: u.docType, id: u.docId, number: u.docNumber },
          qty: qtyString(u.qty),
          returnedQty: qtyString(u.returnedQty),
          daysInStore: u.daysInStore,
        })),
        ...pageMeta(page, total),
      },
    };
  }

  async settings(): Promise<StockAgeSettingsDto> {
    const row = await this.prisma.stockAgeSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
      select: { bands: true, version: true },
    });
    return row;
  }

  async updateSettings(
    input: StockAgeSettingsInput,
    actorId: string,
  ): Promise<StockAgeSettingsDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await ageBands(tx);
      const { count } = await tx.stockAgeSettings.updateMany({
        where: { id: SETTINGS_ID, version: input.version },
        data: {
          bands: input.bands,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      if (count === 0) stale();
      const after = await tx.stockAgeSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
        select: { bands: true, version: true },
      });
      await this.audit.record(
        {
          moduleKey: MODULE_KEY,
          entityKey: 'inventory.stock_age_settings',
          entityId: String(SETTINGS_ID),
          action: 'update',
          before: { bands: before },
          after: { bands: after.bands },
        },
        tx,
      );
      return after;
    });
  }
}
