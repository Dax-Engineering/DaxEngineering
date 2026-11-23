import type { BelowMinReport } from '@dax/inventory-contract';
import type {
  Prisma,
  PrismaService,
  TransactionClient,
} from '@dax/platform-db';
import { qtyString } from '../stock-math';
import { freeOf, shortBy } from './report-math';

type Db = PrismaService | TransactionClient;
type Decimalish = Prisma.Decimal | string | number;

interface BelowMinSql {
  id: string;
  part_no: string;
  brand: string;
  description: string;
  uom: string;
  min_qty: Decimalish;
  on_hand: Decimalish;
  held: Decimalish;
  quarantine: Decimalish;
  receiving: Decimalish;
  waiting: Decimalish;
}

/**
 * Active current part numbers whose family's free stock (on hand less held,
 * quarantine and receiving, across every superseded number) is under the minimum, most short first.
 */
export async function belowMinReport(
  db: Db,
  storeId: string,
  limit: number,
): Promise<BelowMinReport> {
  const rows = await db.$queryRaw<BelowMinSql[]>`
    WITH waiting AS (
      SELECT i.family_id,
        SUM(GREATEST(l.qty_requested - l.qty_issued - l.qty_short_closed - COALESCE(r.qty, 0), 0)) AS qty
      FROM inventory.mrn_line l
      JOIN inventory.mrn m ON m.id = l.mrn_id
      JOIN inventory.item i ON i.id = l.item_id
      LEFT JOIN LATERAL (
        SELECT SUM(qty) AS qty FROM inventory.reservation
        WHERE source = 'MRN' AND source_line_id = l.id
      ) r ON true
      WHERE m.status IN ('CHECKED', 'READY', 'PARTLY_ISSUED')
      GROUP BY i.family_id
    ), family AS (
      SELECT i.family_id,
        SUM(COALESCE(b.on_hand, 0)) AS on_hand, SUM(COALESCE(b.held, 0)) AS held,
        SUM(COALESCE(b.quarantine, 0)) AS quarantine, SUM(COALESCE(b.receiving, 0)) AS receiving
      FROM inventory.item i
      LEFT JOIN inventory.stock_balance b ON b.item_id = i.id AND b.store_id = ${storeId}::uuid
      GROUP BY i.family_id
    ), stock AS (
      SELECT c.id, c.part_no, br.name AS brand, c.description, c.uom, c.min_qty,
        COALESCE(f.on_hand, 0) AS on_hand, COALESCE(f.held, 0) AS held,
        COALESCE(f.quarantine, 0) AS quarantine, COALESCE(f.receiving, 0) AS receiving,
        COALESCE(w.qty, 0) AS waiting
      FROM inventory.item c
      JOIN inventory.brand br ON br.id = c.brand_id
      LEFT JOIN family f ON f.family_id = c.id
      LEFT JOIN waiting w ON w.family_id = c.id
      WHERE c.status = 'ACTIVE' AND c.min_qty > 0 AND c.superseded_by_id IS NULL
    )
    SELECT id::text AS id, part_no, brand, description, uom, min_qty,
      on_hand, held, quarantine, receiving, waiting
    FROM stock
    WHERE on_hand - held - quarantine - receiving < min_qty
    ORDER BY min_qty - (on_hand - held - quarantine - receiving) DESC, part_no, id
    LIMIT ${limit + 1}`;
  return {
    items: rows.slice(0, limit).map((r) => {
      const free = freeOf({
        onHand: r.on_hand,
        held: r.held,
        quarantine: r.quarantine,
        receiving: r.receiving,
      });
      return {
        item: {
          id: r.id,
          partNo: r.part_no,
          brand: r.brand,
          description: r.description,
          uom: r.uom,
        },
        minQty: qtyString(r.min_qty),
        onHand: qtyString(r.on_hand),
        held: qtyString(r.held),
        free: qtyString(free),
        shortBy: qtyString(shortBy(r.min_qty, free)),
        waiting: qtyString(r.waiting),
      };
    }),
    truncated: rows.length > limit,
  };
}
