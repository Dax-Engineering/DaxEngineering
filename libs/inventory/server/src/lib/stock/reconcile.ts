import { Injectable, Logger } from '@nestjs/common';
import { type JobContext, Scheduled } from '@dax/platform-core';
import type { TransactionClient } from '@dax/platform-db';
import { makeExistingSerials } from '../receiving/serials';
import { rebuildStockAge } from './stock-age';

export interface Mismatch {
  check:
    | 'bins_vs_balance'
    | 'ledger_vs_bin'
    | 'buckets'
    | 'held_vs_reserved'
    | 'age_layers';
  itemId: string;
  binId: string | null;
  expected: string;
  actual: string;
}

export async function findMismatches(
  tx: TransactionClient,
): Promise<Mismatch[]> {
  const binsVsBalance = await tx.$queryRaw<
    { item_id: string; expected: string; actual: string }[]
  >`
    SELECT sb.item_id, coalesce(sum(bs.qty), 0)::text AS expected, sb.on_hand::text AS actual
    FROM inventory.stock_balance sb
    LEFT JOIN inventory.bin b ON b.store_id = sb.store_id
    LEFT JOIN inventory.bin_stock bs ON bs.bin_id = b.id AND bs.item_id = sb.item_id
    GROUP BY sb.store_id, sb.item_id, sb.on_hand
    HAVING coalesce(sum(bs.qty), 0) <> sb.on_hand`;

  const ledgerVsBin = await tx.$queryRaw<
    { item_id: string; bin_id: string; expected: string; actual: string }[]
  >`
    SELECT coalesce(l.item_id, bs.item_id) AS item_id, coalesce(l.bin_id, bs.bin_id) AS bin_id,
           coalesce(l.total, 0)::text AS expected, coalesce(bs.qty, 0)::text AS actual
    FROM (SELECT item_id, bin_id, sum(qty) AS total FROM inventory.stock_ledger GROUP BY item_id, bin_id) l
    FULL JOIN inventory.bin_stock bs ON bs.item_id = l.item_id AND bs.bin_id = l.bin_id
    WHERE coalesce(l.total, 0) <> coalesce(bs.qty, 0)`;

  const buckets = await tx.$queryRaw<
    { item_id: string; expected: string; actual: string }[]
  >`
    SELECT sb.item_id,
           (coalesce(sum(bs.qty) FILTER (WHERE b.kind = 'RECEIVING'), 0)::text || '/' ||
            coalesce(sum(bs.qty) FILTER (WHERE b.kind = 'QUARANTINE'), 0)::text) AS expected,
           (sb.receiving::text || '/' || sb.quarantine::text) AS actual
    FROM inventory.stock_balance sb
    LEFT JOIN inventory.bin b ON b.store_id = sb.store_id
    LEFT JOIN inventory.bin_stock bs ON bs.bin_id = b.id AND bs.item_id = sb.item_id
    GROUP BY sb.store_id, sb.item_id, sb.receiving, sb.quarantine
    HAVING coalesce(sum(bs.qty) FILTER (WHERE b.kind = 'RECEIVING'), 0) <> sb.receiving
        OR coalesce(sum(bs.qty) FILTER (WHERE b.kind = 'QUARANTINE'), 0) <> sb.quarantine`;

  const heldVsReserved = await tx.$queryRaw<
    { item_id: string; expected: string; actual: string }[]
  >`
    SELECT sb.item_id, coalesce(sum(r.qty), 0)::text AS expected, sb.held::text AS actual
    FROM inventory.stock_balance sb
    LEFT JOIN inventory.reservation r ON r.item_id = sb.item_id AND r.store_id = sb.store_id
    GROUP BY sb.store_id, sb.item_id, sb.held
    HAVING coalesce(sum(r.qty), 0) <> sb.held`;

  // Shelf stock must equal what its age layers hold, once they have been built.
  const ageLayers = await tx.$queryRaw<
    { item_id: string; expected: string; actual: string }[]
  >`
    WITH shelf AS (
      SELECT b.store_id, bs.item_id, sum(bs.qty) AS qty
      FROM inventory.bin_stock bs JOIN inventory.bin b ON b.id = bs.bin_id
      WHERE b.kind = 'STORAGE' GROUP BY b.store_id, bs.item_id
    ), layers AS (
      SELECT store_id, item_id, sum(qty_left) AS qty FROM inventory.stock_layer
      GROUP BY store_id, item_id
    )
    SELECT coalesce(s.item_id, l.item_id) AS item_id,
           coalesce(s.qty, 0)::text AS expected, coalesce(l.qty, 0)::text AS actual
    FROM shelf s FULL JOIN layers l ON l.store_id = s.store_id AND l.item_id = s.item_id
    WHERE coalesce(s.qty, 0) <> coalesce(l.qty, 0)
      AND EXISTS (SELECT 1 FROM inventory.stock_age_settings WHERE rebuilt_at IS NOT NULL)`;

  return [
    ...ageLayers.map((r) => ({
      check: 'age_layers' as const,
      itemId: r.item_id,
      binId: null,
      expected: r.expected,
      actual: r.actual,
    })),
    ...heldVsReserved.map((r) => ({
      check: 'held_vs_reserved' as const,
      itemId: r.item_id,
      binId: null,
      expected: r.expected,
      actual: r.actual,
    })),
    ...binsVsBalance.map((r) => ({
      check: 'bins_vs_balance' as const,
      itemId: r.item_id,
      binId: null,
      expected: r.expected,
      actual: r.actual,
    })),
    ...ledgerVsBin.map((r) => ({
      check: 'ledger_vs_bin' as const,
      itemId: r.item_id,
      binId: r.bin_id,
      expected: r.expected,
      actual: r.actual,
    })),
    ...buckets.map((r) => ({
      check: 'buckets' as const,
      itemId: r.item_id,
      binId: null,
      expected: r.expected,
      actual: r.actual,
    })),
  ];
}

@Injectable()
export class StockReconcileJob {
  private readonly logger = new Logger('StockReconcile');

  @Scheduled({
    name: 'inventory.reconcile',
    everySeconds: 24 * 3600,
    timeoutSeconds: 120,
  })
  async run(ctx: JobContext): Promise<void> {
    const mismatches = await findMismatches(ctx.tx);
    if (mismatches.length) {
      this.logger.error(
        { count: mismatches.length, first: mismatches.slice(0, 20) },
        'Stock figures do not agree with the ledger',
      );
      return;
    }
    this.logger.log('Stock figures agree with the ledger');
  }
}

@Injectable()
export class StockAgeRebuildJob {
  private readonly logger = new Logger('StockAge');

  /** Builds the age layers from the stock ledger once, after the stock age update goes live. */
  @Scheduled({
    name: 'inventory.stock_age_rebuild',
    everySeconds: 300,
    timeoutSeconds: 600,
  })
  async run(ctx: JobContext): Promise<void> {
    const settings = await ctx.tx.stockAgeSettings.findUnique({
      where: { id: 1 },
      select: { rebuiltAt: true },
    });
    if (!settings || settings.rebuiltAt) return;
    const movements = await rebuildStockAge(ctx.tx);
    await ctx.tx.stockAgeSettings.update({
      where: { id: 1 },
      data: { rebuiltAt: ctx.now },
    });
    this.logger.log({ movements }, 'Stock age layers built from the ledger');
  }
}

@Injectable()
export class ExistingSerialsJob {
  private readonly logger = new Logger('Serials');

  /** Gives the stock already in the store its serials once, after the age layers are built. */
  @Scheduled({
    name: 'inventory.serials_existing',
    everySeconds: 300,
    timeoutSeconds: 600,
  })
  async run(ctx: JobContext): Promise<void> {
    const [settings, age] = await Promise.all([
      ctx.tx.itemSerialSettings.findUnique({
        where: { id: 1 },
        select: { existingDoneAt: true },
      }),
      ctx.tx.stockAgeSettings.findUnique({
        where: { id: 1 },
        select: { rebuiltAt: true },
      }),
    ]);
    if (!settings || settings.existingDoneAt || !age?.rebuiltAt) return;
    const made = await makeExistingSerials(ctx.tx);
    await ctx.tx.itemSerialSettings.update({
      where: { id: 1 },
      data: { existingDoneAt: ctx.now },
    });
    this.logger.log(
      { made },
      'Serials made for the stock already in the store',
    );
  }
}
