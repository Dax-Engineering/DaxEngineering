import { z } from 'zod';
import { OptionalText, PageQuery, pageOf, Qty } from '@dax/contracts';

const PositiveQty = Qty.refine((q) => Number(q) > 0, 'Must be more than 0');
const ItemRef = z.object({
  id: z.uuid(),
  partNo: z.string(),
  brand: z.string(),
  description: z.string(),
  uom: z.string(),
});

export const BundleLineInput = z.strictObject({
  itemId: z.uuid(),
  qty: PositiveQty,
});
export const BundleInput = z.strictObject({
  name: z.string().trim().min(2).max(80),
  description: OptionalText(300),
  lines: z.array(BundleLineInput).min(1).max(100),
});
export type BundleInput = z.infer<typeof BundleInput>;
export const BundleUpdate = BundleInput.extend({ version: z.int() });
export type BundleUpdate = z.infer<typeof BundleUpdate>;
export const BundleStatusInput = z.strictObject({
  version: z.int(),
  active: z.boolean(),
});

export const BundleSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  partCount: z.int(),
});
export type BundleSummary = z.infer<typeof BundleSummary>;
export const BundlePage = pageOf(BundleSummary);
export type BundlePage = z.infer<typeof BundlePage>;
export const BundleDto = BundleSummary.extend({
  version: z.int(),
  lines: z.array(z.object({ item: ItemRef, qty: z.string() })),
});
export type BundleDto = z.infer<typeof BundleDto>;
export const BundleQuery = PageQuery.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
});
export type BundleQuery = z.infer<typeof BundleQuery>;
