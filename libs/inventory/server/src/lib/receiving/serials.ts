import { createHash } from 'node:crypto';
import { SERIAL_ALPHABET, SERIAL_LENGTH, UOMS } from '@dax/inventory-contract';
import type { Prisma, TransactionClient } from '@dax/platform-db';
import { dec, qtyString } from '../stock-math';

type Condition = 'GOOD' | 'DAMAGED';

/** 16 Crockford base32 characters from a SHA-256 of the receipt data. */
export function serialHash(parts: readonly string[], salt = 0): string {
  const bytes = createHash('sha256')
    .update([...parts, String(salt)].join('|'))
    .digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < SERIAL_LENGTH) {
      out += SERIAL_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length === SERIAL_LENGTH) break;
  }
  return out;
}

export function isBulkUom(uom: string): boolean {
  return UOMS.some((u) => u.code === uom && u.fraction);
}

export interface SerialDraft {
  hashParts: string[];
  row: SerialFields;
}

interface SerialFields {
  itemId: string;
  source: 'GRN' | 'EXISTING';
  docType: string;
  docId: string;
  docLineId: string | null;
  docNumber: string | null;
  binId: string | null;
  lineNo: number | null;
  unitNo: number;
  qty: string;
  condition: Condition;
  receivedAt: Date;
  supplierName: string | null;
}

/** Units of a line: one per whole unit, or one batch for parts sold by length or weight. */
export function unitsOf(
  uom: string,
  qty: Prisma.Decimal | string,
): { unitNo: number; qty: string }[] {
  const amount = dec(qty);
  if (!amount.gt(0)) return [];
  if (isBulkUom(uom)) return [{ unitNo: 1, qty: qtyString(amount) }];
  return Array.from({ length: Math.floor(amount.toNumber()) }, (_, i) => ({
    unitNo: i + 1,
    qty: '1',
  }));
}

/** Writes the drafts with unique serials, re-hashing with a new salt on the rare clash. */
export async function saveSerials(
  tx: TransactionClient,
  drafts: readonly SerialDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const salts = drafts.map(() => 0);
  const serials = drafts.map((d) => serialHash(d.hashParts));
  for (let round = 0; round < 10; round++) {
    const taken = new Set(
      (
        await tx.itemSerial.findMany({
          where: { serial: { in: serials } },
          select: { serial: true },
        })
      ).map((r) => r.serial),
    );
    const seen = new Set<string>();
    let clashes = 0;
    serials.forEach((s, i) => {
      if (taken.has(s) || seen.has(s)) {
        salts[i] = (salts[i] ?? 0) + 1;
        serials[i] = serialHash(drafts[i]?.hashParts ?? [], salts[i]);
        clashes++;
      }
      seen.add(serials[i] ?? s);
    });
    if (clashes === 0) break;
  }
  await tx.itemSerial.createMany({
    data: drafts.map((d, i) => ({ ...d.row, serial: serials[i] as string })),
  });
  return drafts.length;
}

/** Serials for every unit a posted GRN received, good units first. */
export async function makeGrnSerials(
  tx: TransactionClient,
  grn: {
    id: string;
    number: string;
    supplierName: string | null;
    receivedAt: Date;
    receivingBinId: string;
    quarantineBinId: string;
  },
  lines: readonly {
    id: string;
    lineNo: number;
    qtyGood: Prisma.Decimal | string;
    qtyDamaged: Prisma.Decimal | string;
    item: { id: string; partNo: string; brand: string; uom: string };
  }[],
): Promise<number> {
  const drafts: SerialDraft[] = [];
  for (const line of lines) {
    const bulk = isBulkUom(line.item.uom);
    const good = unitsOf(line.item.uom, line.qtyGood);
    const damaged = unitsOf(line.item.uom, line.qtyDamaged).map((u) => ({
      ...u,
      unitNo: bulk ? 1 : u.unitNo + good.length,
    }));
    const units: { unitNo: number; qty: string; condition: Condition }[] = [
      ...good.map((u) => ({ ...u, condition: 'GOOD' as const })),
      ...damaged.map((u) => ({ ...u, condition: 'DAMAGED' as const })),
    ];
    for (const u of units) {
      drafts.push({
        hashParts: [
          line.item.partNo,
          line.item.brand,
          grn.number,
          String(line.lineNo),
          String(u.unitNo),
          u.condition,
          grn.receivedAt.toISOString(),
        ],
        row: {
          itemId: line.item.id,
          source: 'GRN',
          docType: 'GRN',
          docId: grn.id,
          docLineId: line.id,
          docNumber: grn.number,
          binId:
            u.condition === 'GOOD' ? grn.receivingBinId : grn.quarantineBinId,
          lineNo: line.lineNo,
          unitNo: u.unitNo,
          qty: u.qty,
          condition: u.condition,
          receivedAt: grn.receivedAt,
          supplierName: grn.supplierName,
        },
      });
    }
  }
  return saveSerials(tx, drafts);
}

/** Put-away moves a line's good serials still in the receiving bin, lowest unit numbers first. */
export async function moveSerials(
  tx: TransactionClient,
  move: {
    grnLineId: string;
    fromBinId: string;
    toBinId: string;
    qty: Prisma.Decimal;
  },
): Promise<void> {
  const waiting = await tx.itemSerial.findMany({
    where: {
      docLineId: move.grnLineId,
      binId: move.fromBinId,
      condition: 'GOOD',
      status: 'ACTIVE',
    },
    orderBy: { unitNo: 'asc' },
    select: { id: true, qty: true },
  });
  const ids: string[] = [];
  let left = move.qty;
  for (const s of waiting) {
    if (!left.gt(0)) break;
    ids.push(s.id);
    left = left.minus(dec(s.qty));
  }
  if (ids.length) {
    await tx.itemSerial.updateMany({
      where: { id: { in: ids } },
      data: { binId: move.toBinId },
    });
  }
}

export async function voidSerials(
  tx: TransactionClient,
  docId: string,
  at: Date,
): Promise<number> {
  const { count } = await tx.itemSerial.updateMany({
    where: { docId, status: 'ACTIVE' },
    data: { status: 'VOID', voidedAt: at },
  });
  return count;
}

interface StockSql {
  item_id: string;
  bin_id: string;
  bin_code: string;
  kind: 'STORAGE' | 'RECEIVING' | 'QUARANTINE';
  qty: Prisma.Decimal;
  part_no: string;
  brand: string;
  uom: string;
}

/**
 * Serials for the stock already in the store: shelf stock follows its age layers
 * oldest first, receiving and quarantine stock its latest receipt.
 */
export async function makeExistingSerials(
  tx: TransactionClient,
  itemIds?: readonly string[],
): Promise<number> {
  const only = itemIds ? [...itemIds] : null;
  const stock = await tx.$queryRaw<StockSql[]>`
    SELECT bs.item_id, bs.bin_id, b.code AS bin_code, b.kind::text AS kind,
      bs.qty - coalesce(done.qty, 0) AS qty, i.part_no, br.name AS brand, i.uom
    FROM inventory.bin_stock bs
    JOIN inventory.bin b ON b.id = bs.bin_id
    JOIN inventory.item i ON i.id = bs.item_id
    JOIN inventory.brand br ON br.id = i.brand_id
    LEFT JOIN (
      SELECT item_id, bin_id, sum(qty) AS qty FROM inventory.item_serial
      WHERE status = 'ACTIVE' GROUP BY item_id, bin_id
    ) done ON done.item_id = bs.item_id AND done.bin_id = bs.bin_id
    WHERE bs.qty - coalesce(done.qty, 0) > 0
      AND b.kind IN ('STORAGE', 'RECEIVING', 'QUARANTINE')
      AND (${only}::uuid[] IS NULL OR bs.item_id = ANY(${only}::uuid[]))
    ORDER BY bs.item_id, b.code`;
  const drafts: SerialDraft[] = [];
  const byItem = new Map<string, StockSql[]>();
  for (const row of stock) {
    byItem.set(row.item_id, [...(byItem.get(row.item_id) ?? []), row]);
  }
  for (const [itemId, rows] of byItem) {
    // Shelf units take their arrival from the age layers, oldest first.
    const layers = (
      await tx.stockLayer.findMany({
        where: { itemId, qtyLeft: { gt: 0 } },
        orderBy: [{ agedFrom: 'asc' }, { id: 'asc' }],
      })
    ).map((l) => ({ ...l, left: dec(l.qtyLeft) }));
    let unit = 0;
    for (const row of rows) {
      const bulk = isBulkUom(row.uom);
      if (row.kind !== 'STORAGE') {
        const receipt = await tx.stockLedger.findFirst({
          where: {
            itemId,
            binId: row.bin_id,
            movement: { in: ['RECEIVE', 'RECEIVE_DAMAGED'] },
          },
          orderBy: { occurredAt: 'desc' },
        });
        const condition: Condition =
          row.kind === 'QUARANTINE' ? 'DAMAGED' : 'GOOD';
        for (const u of unitsOf(row.uom, row.qty)) {
          unit++;
          drafts.push(
            existingDraft(row, unit, u.qty, condition, {
              docType: receipt?.docType ?? 'STOCK',
              docId: receipt?.docId ?? row.bin_id,
              docLineId: receipt?.docLineId ?? null,
              docNumber: receipt?.docNumber ?? null,
              at: receipt?.occurredAt ?? new Date(),
            }),
          );
        }
        continue;
      }
      let left = dec(row.qty);
      while (bulk ? left.gt(0) : left.gte(1)) {
        const layer = layers.find((l) => l.left.gt(0));
        const take = !bulk ? dec(1) : layer ? minDec(layer.left, left) : left;
        const from = layer
          ? {
              docType: layer.docType,
              docId: layer.docId,
              docLineId: layer.docLineId,
              docNumber: layer.docNumber,
              at: layer.agedFrom,
            }
          : {
              docType: 'STOCK',
              docId: row.bin_id,
              docLineId: null,
              docNumber: null,
              at: new Date(),
            };
        unit++;
        drafts.push(existingDraft(row, unit, qtyString(take), 'GOOD', from));
        if (layer) layer.left = layer.left.minus(take);
        left = left.minus(take);
      }
    }
  }
  return saveSerials(tx, drafts);
}

function minDec(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lt(b) ? a : b;
}

function existingDraft(
  row: StockSql,
  unitNo: number,
  qty: string,
  condition: Condition,
  from: {
    docType: string;
    docId: string;
    docLineId: string | null;
    docNumber: string | null;
    at: Date;
  },
): SerialDraft {
  return {
    hashParts: [
      row.part_no,
      row.brand,
      from.docNumber ?? from.docId,
      row.bin_code,
      String(unitNo),
      condition,
      from.at.toISOString(),
      'EXISTING',
    ],
    row: {
      itemId: row.item_id,
      source: 'EXISTING',
      docType: from.docType,
      docId: from.docId,
      docLineId: from.docLineId,
      docNumber: from.docNumber,
      binId: row.bin_id,
      lineNo: null,
      unitNo,
      qty,
      condition,
      receivedAt: from.at,
      supplierName: null,
    },
  };
}
