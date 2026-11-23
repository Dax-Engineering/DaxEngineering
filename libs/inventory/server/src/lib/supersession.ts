export const MAX_CHAIN = 100;

export type NextOf = (id: string) => Promise<string | null>;

export async function latestReplacementId(
  supersededById: string | null,
  nextOf: NextOf,
): Promise<string | null> {
  if (!supersededById) return null;
  const seen = new Set<string>();
  let current = supersededById;
  for (let hop = 0; hop < MAX_CHAIN; hop++) {
    seen.add(current);
    const next = await nextOf(current);
    if (!next || seen.has(next)) return current;
    current = next;
  }
  return current;
}

export async function createsCycle(
  itemId: string,
  replacementId: string,
  nextOf: NextOf,
): Promise<boolean> {
  if (itemId === replacementId) return true;
  const seen = new Set<string>([replacementId]);
  let current: string | null = replacementId;
  for (let hop = 0; hop < MAX_CHAIN && current; hop++) {
    const next: string | null = await nextOf(current);
    if (!next) return false;
    if (next === itemId || seen.has(next)) return true;
    seen.add(next);
    current = next;
  }
  return current !== null;
}

interface RawDb {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}

/**
 * Re-points an item and every older number behind it at their family's current
 * item, with each one's distance from it. Run after changing `supersededById`.
 */
export function refreshFamily(db: RawDb, itemId: string): Promise<number> {
  return db.$executeRaw`
    WITH RECURSIVE up AS (
      SELECT id, superseded_by_id, 0 AS hops FROM inventory.item WHERE id = ${itemId}::uuid
      UNION ALL
      SELECT i.id, i.superseded_by_id, up.hops + 1
      FROM inventory.item i JOIN up ON i.id = up.superseded_by_id
      WHERE up.hops < ${MAX_CHAIN}
    ), root AS (
      SELECT id AS root_id, hops FROM up WHERE superseded_by_id IS NULL
      ORDER BY hops DESC LIMIT 1
    ), down AS (
      SELECT id, 0 AS d FROM inventory.item WHERE id = ${itemId}::uuid
      UNION ALL
      SELECT i.id, down.d + 1
      FROM inventory.item i JOIN down ON i.superseded_by_id = down.id
      WHERE down.d < ${MAX_CHAIN}
    )
    UPDATE inventory.item i
    SET family_id = root.root_id, family_depth = root.hops + down.d
    FROM down, root
    WHERE i.id = down.id`;
}
