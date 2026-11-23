import type { Prisma, TransactionClient } from '@dax/platform-db';
import { daysSince } from '../reports/report-math';
import { dec, qtyString } from '../stock-math';
import type { MovementKind } from './stock-posting.service';

/** One posted movement in a storage bin; qty is signed. */
export interface AgeEntry {
  itemId: string;
  qty: Prisma.Decimal;
  movement: MovementKind;
  docType: string;
  docId: string;
  docLineId: string | null;
  docNumber: string | null;
  ledgerId: string;
}

type Source = 'GRN' | 'OPENING' | 'RETURN' | 'COUNT' | 'OTHER';

/** Colombo calendar days from one time to another, never below zero. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, daysSince(from, to));
}

const min = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.lt(b) ? a : b);
const sum = (rows: readonly AgeEntry[]) =>
  rows.reduce((t, r) => t.plus(r.qty.abs()), dec(0));

/** Drops the first `skip` of a list of quantities, so moves between storage bins leave the layers alone. */
function afterSkip(
  rows: readonly AgeEntry[],
  skip: Prisma.Decimal,
): { entry: AgeEntry; qty: Prisma.Decimal }[] {
  let left = skip;
  const out: { entry: AgeEntry; qty: Prisma.Decimal }[] = [];
  for (const entry of rows) {
    const qty = entry.qty.abs();
    const skipped = min(qty, left);
    left = left.minus(skipped);
    if (qty.gt(skipped)) out.push({ entry, qty: qty.minus(skipped) });
  }
  return out;
}

/**
 * Keeps the age layers in step with one posting batch in storage bins:
 * stock arriving on the shelf opens a layer, stock leaving it is taken from
 * the oldest layers first and recorded with its days in store.
 */
export async function applyStockAge(
  tx: TransactionClient,
  storeId: string,
  at: Date,
  entries: readonly AgeEntry[],
): Promise<void> {
  const byItem = new Map<string, AgeEntry[]>();
  for (const e of entries) {
    if (e.qty.isZero()) continue;
    byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  }
  for (const [itemId, rows] of byItem) {
    const ins = rows.filter((r) => r.qty.gt(0));
    const outs = rows.filter((r) => r.qty.lt(0));
    const moved = min(sum(ins), sum(outs));
    for (const { entry, qty } of afterSkip(outs, moved)) {
      await takeOldest(tx, storeId, itemId, qty, entry, at);
    }
    for (const { entry, qty } of afterSkip(ins, moved)) {
      await addLayers(tx, storeId, itemId, qty, entry, at);
    }
  }
}

async function takeOldest(
  tx: TransactionClient,
  storeId: string,
  itemId: string,
  qty: Prisma.Decimal,
  entry: AgeEntry,
  at: Date,
): Promise<void> {
  // A reversed GRN takes back its own layer first.
  const own = entry.movement === 'REVERSAL' ? entry.docId : null;
  const layers = await tx.$queryRaw<
    { id: string; aged_from: Date; qty_left: Prisma.Decimal }[]
  >`
    SELECT id, aged_from, qty_left FROM inventory.stock_layer
    WHERE store_id = ${storeId}::uuid AND item_id = ${itemId}::uuid AND qty_left > 0
    ORDER BY (doc_id = ${own}::uuid) IS TRUE DESC, aged_from, id
    FOR UPDATE`;
  let left = qty;
  for (const layer of layers) {
    if (!left.gt(0)) break;
    const take = min(dec(layer.qty_left), left);
    left = left.minus(take);
    await tx.stockLayer.update({
      where: { id: layer.id },
      data: { qtyLeft: { decrement: qtyString(take) } },
    });
    await tx.stockLayerUse.create({
      data: {
        layerId: layer.id,
        itemId,
        ledgerId: entry.ledgerId,
        movement: entry.movement,
        docType: entry.docType,
        docId: entry.docId,
        docLineId: entry.docLineId,
        docNumber: entry.docNumber,
        qty: qtyString(take),
        usedAt: at,
        daysInStore: daysBetween(layer.aged_from, at),
      },
    });
  }
  // Whatever no layer covers is stock that never had one; the nightly reconcile reports it.
}

interface NewLayer {
  qty: Prisma.Decimal;
  agedFrom: Date;
  atLeast: boolean;
  source: Source;
}

async function addLayers(
  tx: TransactionClient,
  storeId: string,
  itemId: string,
  qty: Prisma.Decimal,
  entry: AgeEntry,
  at: Date,
): Promise<void> {
  const layers =
    entry.movement === 'RETURN'
      ? await returnedLayers(tx, itemId, qty, entry, at)
      : [{ qty, ...(await arrival(tx, entry, at)) }];
  for (const layer of layers) {
    await tx.stockLayer.create({
      data: {
        storeId,
        itemId,
        agedFrom: layer.agedFrom,
        atLeast: layer.atLeast,
        source: layer.source,
        docType: entry.docType,
        docId: entry.docId,
        docLineId: entry.docLineId,
        docNumber: entry.docNumber,
        qtyIn: qtyString(layer.qty),
        qtyLeft: qtyString(layer.qty),
      },
    });
  }
}

async function arrival(
  tx: TransactionClient,
  entry: AgeEntry,
  at: Date,
): Promise<Omit<NewLayer, 'qty'>> {
  if (entry.movement === 'PUTAWAY_IN' && entry.docLineId) {
    // The clock starts when the GRN received it, not when it reached the shelf.
    const received = await tx.stockLedger.findFirst({
      where: { docLineId: entry.docLineId, movement: 'RECEIVE' },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });
    return {
      agedFrom: received?.occurredAt ?? at,
      atLeast: false,
      source: 'GRN',
    };
  }
  if (entry.movement === 'OPENING')
    return { agedFrom: at, atLeast: true, source: 'OPENING' };
  if (entry.movement === 'COUNT_ADJUST')
    return { agedFrom: at, atLeast: false, source: 'COUNT' };
  return { agedFrom: at, atLeast: false, source: 'OTHER' };
}

/** A return keeps the age the part left with; the days it was out do not count. */
async function returnedLayers(
  tx: TransactionClient,
  itemId: string,
  qty: Prisma.Decimal,
  entry: AgeEntry,
  at: Date,
): Promise<NewLayer[]> {
  const line = entry.docLineId
    ? await tx.returnLine.findUnique({
        where: { id: entry.docLineId },
        select: { aodLineId: true },
      })
    : null;
  const uses = line?.aodLineId
    ? await tx.$queryRaw<
        {
          id: string;
          qty: Prisma.Decimal;
          returned_qty: Prisma.Decimal;
          used_at: Date;
          aged_from: Date;
          at_least: boolean;
        }[]
      >`
        SELECT u.id, u.qty, u.returned_qty, u.used_at, l.aged_from, l.at_least
        FROM inventory.stock_layer_use u
        JOIN inventory.stock_layer l ON l.id = u.layer_id
        WHERE u.doc_line_id = ${line.aodLineId}::uuid AND u.item_id = ${itemId}::uuid
          AND u.qty > u.returned_qty
        ORDER BY l.aged_from DESC, u.id
        FOR UPDATE OF u`
    : [];
  const layers: NewLayer[] = [];
  let left = qty;
  for (const use of uses) {
    if (!left.gt(0)) break;
    const take = min(dec(use.qty).minus(dec(use.returned_qty)), left);
    left = left.minus(take);
    await tx.stockLayerUse.update({
      where: { id: use.id },
      data: { returnedQty: { increment: qtyString(take) } },
    });
    const out = Math.max(0, at.getTime() - use.used_at.getTime());
    layers.push({
      qty: take,
      agedFrom: new Date(use.aged_from.getTime() + out),
      atLeast: use.at_least,
      source: 'RETURN',
    });
  }
  if (left.gt(0))
    layers.push({ qty: left, agedFrom: at, atLeast: false, source: 'RETURN' });
  return layers;
}

/** Rebuilds the layers from the stock ledger, oldest posting first: every item, or only the ones given. */
export async function rebuildStockAge(
  tx: TransactionClient,
  itemIds?: readonly string[],
): Promise<number> {
  const only = itemIds ? [...itemIds] : null;
  if (!only)
    await tx.$executeRaw`LOCK TABLE inventory.stock_layer IN EXCLUSIVE MODE`;
  await tx.$executeRaw`
    DELETE FROM inventory.stock_layer
    WHERE ${only}::uuid[] IS NULL OR item_id = ANY(${only}::uuid[])`;
  const rows = await tx.$queryRaw<
    {
      id: string;
      occurred_at: Date;
      store_id: string;
      item_id: string;
      qty: Prisma.Decimal;
      movement: MovementKind;
      doc_type: string;
      doc_id: string;
      doc_line_id: string | null;
      doc_number: string | null;
    }[]
  >`
    SELECT l.id, l.occurred_at, l.store_id, l.item_id, l.qty, l.movement::text AS movement,
      l.doc_type, l.doc_id, l.doc_line_id, l.doc_number
    FROM inventory.stock_ledger l
    JOIN inventory.bin b ON b.id = l.bin_id
    WHERE b.kind = 'STORAGE'
      AND (${only}::uuid[] IS NULL OR l.item_id = ANY(${only}::uuid[]))
    ORDER BY l.occurred_at, l.id`;
  // Everything posted in one transaction shares its timestamp, so it is replayed as one batch.
  let batch: typeof rows = [];
  const flush = async () => {
    const first = batch[0];
    if (!first) return;
    await applyStockAge(
      tx,
      first.store_id,
      first.occurred_at,
      batch.map((r) => ({
        itemId: r.item_id,
        qty: dec(r.qty),
        movement: r.movement,
        docType: r.doc_type,
        docId: r.doc_id,
        docLineId: r.doc_line_id,
        docNumber: r.doc_number,
        ledgerId: r.id,
      })),
    );
    batch = [];
  };
  for (const row of rows) {
    const first = batch[0];
    if (
      first &&
      (first.occurred_at.getTime() !== row.occurred_at.getTime() ||
        first.store_id !== row.store_id)
    ) {
      await flush();
    }
    batch.push(row);
  }
  await flush();
  return rows.length;
}
