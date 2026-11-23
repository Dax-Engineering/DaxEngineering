import type { TransactionClient } from '@dax/platform-db';
import { notFound } from '../common';

export const CUSTOMER_PART_PADDING = 5;

export function customerPartNo(customerCode: string, seq: number): string {
  return `${customerCode}-${String(seq).padStart(CUSTOMER_PART_PADDING, '0')}`;
}

async function numbered(
  tx: TransactionClient,
  customerId: string,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await tx.customerPart.findMany({
    where: { customerId, itemId: { in: [...itemIds] } },
    select: { itemId: true, partNo: true },
  });
  return new Map(rows.map((p) => [p.itemId, p.partNo]));
}

/**
 * The customer's own part number for each item, generating the missing ones:
 * one per customer per part, in the customer's own running sequence.
 */
export async function ensureCustomerParts(
  tx: TransactionClient,
  customerId: string,
  itemIds: readonly string[],
  actorId: string,
): Promise<Map<string, string>> {
  const wanted = [...new Set(itemIds)].sort();
  if (wanted.length === 0) return new Map();
  const known = await numbered(tx, customerId, wanted);
  if (known.size === wanted.length) return known;

  // Locking the customer's counter queues concurrent pickers, so numbers have no gaps or clashes.
  await tx.$executeRaw`
    INSERT INTO inventory.customer_part_counter (customer_id, last)
    VALUES (${customerId}::uuid, 0) ON CONFLICT (customer_id) DO NOTHING`;
  const [counter] = await tx.$queryRaw<{ last: number }[]>`
    SELECT last FROM inventory.customer_part_counter
    WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
  const numbers = await numbered(tx, customerId, wanted);
  const missing = wanted.filter((id) => !numbers.has(id));
  if (missing.length === 0) return numbers;

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { code: true, name: true },
  });
  if (!customer) notFound('Customer not found.');
  const first = Number(counter.last) + 1;
  const rows = missing.map((itemId, i) => ({
    customerId,
    customerCode: customer.code,
    customerName: customer.name,
    itemId,
    seq: first + i,
    partNo: customerPartNo(customer.code, first + i),
    createdBy: actorId,
  }));
  await tx.customerPart.createMany({ data: rows });
  await tx.customerPartCounter.update({
    where: { customerId },
    data: { last: first + missing.length - 1 },
  });
  for (const row of rows) numbers.set(row.itemId, row.partNo);
  return numbers;
}

/**
 * The customer's number for a bundle, from the same running sequence as parts.
 * A saved bundle keeps one number per customer; a one-off bundle (null) gets a new one.
 */
export async function ensureCustomerBundle(
  tx: TransactionClient,
  customerId: string,
  bundleId: string | null,
  actorId: string,
): Promise<string> {
  const known = bundleId
    ? await tx.customerBundlePart.findUnique({
        where: { customerId_bundleId: { customerId, bundleId } },
        select: { partNo: true },
      })
    : null;
  if (known) return known.partNo;

  await tx.$executeRaw`
    INSERT INTO inventory.customer_part_counter (customer_id, last)
    VALUES (${customerId}::uuid, 0) ON CONFLICT (customer_id) DO NOTHING`;
  const [counter] = await tx.$queryRaw<{ last: number }[]>`
    SELECT last FROM inventory.customer_part_counter
    WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
  if (bundleId) {
    const raced = await tx.customerBundlePart.findUnique({
      where: { customerId_bundleId: { customerId, bundleId } },
      select: { partNo: true },
    });
    if (raced) return raced.partNo;
  }
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { code: true, name: true },
  });
  if (!customer) notFound('Customer not found.');
  const seq = Number(counter.last) + 1;
  const partNo = customerPartNo(customer.code, seq);
  if (bundleId) {
    await tx.customerBundlePart.create({
      data: {
        customerId,
        customerCode: customer.code,
        customerName: customer.name,
        bundleId,
        seq,
        partNo,
        createdBy: actorId,
      },
    });
  }
  await tx.customerPartCounter.update({
    where: { customerId },
    data: { last: seq },
  });
  return partNo;
}
