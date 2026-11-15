import { normalizePartNo } from '@dax/inventory-contract';
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
      { description: { contains: text, mode: 'insensitive' } },
    ],
  };
}

export async function belowMinIds(db: Db, storeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT i.id::text AS id
    FROM inventory.item i
    LEFT JOIN inventory.stock_balance b
      ON b.item_id = i.id AND b.store_id = ${storeId}::uuid
    WHERE i.min_qty > 0 AND COALESCE(b.on_hand, 0) < i.min_qty`;
  return rows.map((r) => r.id);
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
