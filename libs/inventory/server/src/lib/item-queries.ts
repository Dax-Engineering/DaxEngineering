import { normalizePartNo, normalizeSerial } from '@dax/inventory-contract';
import type {
  Prisma,
  PrismaService,
  TransactionClient,
} from '@dax/platform-db';

type Db = PrismaService | TransactionClient;

export function itemSearch(q: string | undefined): Prisma.ItemWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const norm = normalizePartNo(text);
  return {
    OR: [
      ...(norm ? [{ partNoNorm: { contains: norm } }] : []),
      { barcodes: { some: { code: text } } },
      { serials: { some: { serial: normalizeSerial(text) } } },
      {
        customerParts: {
          some: { partNo: { contains: text, mode: 'insensitive' } },
        },
      },
      { description: { contains: text, mode: 'insensitive' } },
    ],
  };
}

/** Current items (one per family) whose family's on-hand stock is under the current item's minimum. */
export async function belowMinIds(db: Db, storeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT r.id::text AS id
    FROM inventory.item r
    LEFT JOIN (
      SELECT i.family_id, SUM(b.on_hand) AS on_hand
      FROM inventory.item i
      JOIN inventory.stock_balance b ON b.item_id = i.id AND b.store_id = ${storeId}::uuid
      GROUP BY i.family_id
    ) f ON f.family_id = r.id
    WHERE r.superseded_by_id IS NULL AND r.min_qty > 0
      AND COALESCE(f.on_hand, 0) < r.min_qty`;
  return rows.map((r) => r.id);
}

/** Matches an item when it or any number of its family matches the search. */
export function familySearch(q: string | undefined): Prisma.ItemWhereInput {
  const own = itemSearch(q);
  if (Object.keys(own).length === 0) return {};
  return { OR: [own, { familyMembers: { some: own } }] };
}

/** The family members of an item, oldest first, with their stock in one store. */
export function familySelect(storeId: string) {
  return {
    select: {
      familyMembers: {
        select: {
          id: true,
          partNo: true,
          familyDepth: true,
          supersededBy: { select: { partNo: true } },
          balances: {
            where: { storeId },
            select: {
              onHand: true,
              held: true,
              quarantine: true,
              receiving: true,
            },
          },
        },
        orderBy: [{ familyDepth: 'desc' as const }, { partNo: 'asc' as const }],
      },
    },
  };
}

export function belowMinFilter(
  flag: 'true' | 'false' | undefined,
  ids: readonly string[],
): Prisma.ItemWhereInput {
  if (flag === 'true') return { id: { in: [...ids] } };
  if (flag === 'false') return { id: { notIn: [...ids] } };
  return {};
}

export function nextOfFor(db: Db) {
  return async (id: string): Promise<string | null> => {
    const row = await db.item.findUnique({
      where: { id },
      select: { supersededById: true },
    });
    return row?.supersededById ?? null;
  };
}

/** Supplier, tags, prices and the machine models (with their types) an item fits. */
export const ITEM_EXTRAS_SELECT = {
  supplierId: true,
  supplierName: true,
  tags: true,
  preCostPrice: true,
  sellingPrice: true,
  machineModels: {
    select: {
      machineModel: {
        select: {
          id: true,
          name: true,
          machineType: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { machineModel: { name: 'asc' } },
  },
} as const satisfies Prisma.ItemSelect;

type ExtrasRow = Prisma.ItemGetPayload<{ select: typeof ITEM_EXTRAS_SELECT }>;

const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

export function itemExtras(row: ExtrasRow) {
  const types = new Map<string, { id: string; name: string }>();
  for (const { machineModel } of row.machineModels) {
    if (machineModel.machineType) {
      types.set(machineModel.machineType.id, machineModel.machineType);
    }
  }
  return {
    supplier:
      row.supplierId && row.supplierName
        ? { id: row.supplierId, name: row.supplierName }
        : null,
    tags: row.tags,
    machineTypes: [...types.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    preCostPrice: money(row.preCostPrice),
    sellingPrice: money(row.sellingPrice),
  };
}

export function extrasFilter(query: {
  supplierId?: string;
  machineTypeId?: string;
  tag?: string;
}): Prisma.ItemWhereInput {
  return {
    AND: [
      query.supplierId ? { supplierId: query.supplierId } : {},
      query.machineTypeId
        ? {
            machineModels: {
              some: { machineModel: { machineTypeId: query.machineTypeId } },
            },
          }
        : {},
      query.tag ? { tags: { has: query.tag } } : {},
    ],
  };
}

/** Trimmed, lower-case, without repeats, in the order given. */
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
