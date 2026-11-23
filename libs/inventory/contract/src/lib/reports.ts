import { z } from 'zod';
import { PageParams, pageOf } from '@dax/contracts';
import { BIN_KINDS } from './dto';
import { MOVEMENT_TYPES, MovementRow } from './receiving';

export const REPORT_ROW_LIMIT = 2000;
export const REPORT_CSV_ROW_LIMIT = 50_000;
export const REPORT_DOC_TYPES = ['GRN', 'AOD', 'RTN', 'CNT', 'WTY'] as const;
export const STOCK_AGE_DEFAULT_BANDS = [30, 90, 180, 365] as const;
export const STOCK_AGE_MAX_BANDS = 6;
export const STOCK_AGE_MAX_DAYS = 3650;

export const REPORT_MOVEMENT_LABELS: Record<
  (typeof MOVEMENT_TYPES)[number],
  string
> = {
  RECEIVE: 'Received',
  RECEIVE_DAMAGED: 'Received damaged',
  PUTAWAY_OUT: 'Put away from',
  PUTAWAY_IN: 'Put away to',
  REVERSAL: 'Reversed',
  ISSUE: 'Issued from',
  RETURN: 'Returned to',
  COUNT_ADJUST: 'Count adjustment',
  OPENING: 'Opening stock',
};

export const REPORT_DOC_LABELS: Record<
  (typeof REPORT_DOC_TYPES)[number],
  string
> = {
  GRN: 'GRNs',
  AOD: 'AODs',
  RTN: 'Return notes',
  CNT: 'Stock counts',
  WTY: 'Warranty tags',
};

export const REPORT_BIN_KIND_LABELS: Record<
  (typeof BIN_KINDS)[number],
  string
> = {
  STORAGE: 'Storage',
  RECEIVING: 'Receiving',
  QUARANTINE: 'Quarantine',
  WARRANTY: 'Warranty',
};

const ReportDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const ReportItem = z.object({
  id: z.uuid(),
  partNo: z.string(),
  brand: z.string(),
  description: z.string(),
  uom: z.string(),
});

export const BelowMinRow = z.object({
  item: ReportItem,
  minQty: z.string(),
  onHand: z.string(),
  held: z.string(),
  free: z.string(),
  shortBy: z.string(),
  waiting: z.string(),
});
export type BelowMinRow = z.infer<typeof BelowMinRow>;
export const BelowMinReport = z.object({
  items: z.array(BelowMinRow),
  truncated: z.boolean(),
});
export type BelowMinReport = z.infer<typeof BelowMinReport>;

export const MovementReportQuery = PageParams.extend({
  from: ReportDay.optional(),
  to: ReportDay.optional(),
  itemId: z.uuid().optional(),
  binId: z.uuid().optional(),
  movement: z.enum(MOVEMENT_TYPES).optional(),
  docType: z.enum(REPORT_DOC_TYPES).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: 'The start date must be on or before the end date.',
  path: ['to'],
});
export type MovementReportQuery = z.infer<typeof MovementReportQuery>;

export const MovementReportRow = MovementRow.extend({
  item: ReportItem.pick({ id: true, partNo: true, uom: true }),
});
export type MovementReportRow = z.infer<typeof MovementReportRow>;
export const MovementReportPage = pageOf(MovementReportRow).extend({
  filterItem: z.object({ id: z.uuid(), label: z.string() }).nullable(),
  filterBin: z.object({ id: z.uuid(), label: z.string() }).nullable(),
});
export type MovementReportPage = z.infer<typeof MovementReportPage>;

export const BinStockQuery = z.object({
  zoneId: z.uuid().optional(),
  kind: z.enum(BIN_KINDS).optional(),
});
export type BinStockQuery = z.infer<typeof BinStockQuery>;

export const BinStockBin = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: z.enum(BIN_KINDS),
  zone: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  beingCounted: z.boolean(),
  lines: z.array(z.object({ item: ReportItem, qty: z.string() })),
});
export type BinStockBin = z.infer<typeof BinStockBin>;
export const BinStockReport = z.object({
  bins: z.array(BinStockBin),
  truncated: z.boolean(),
});
export type BinStockReport = z.infer<typeof BinStockReport>;

/** Band labels for upper day limits: [30, 90] gives 0–30, 31–90 and 91+. */
export function stockAgeBandLabels(bands: readonly number[]): string[] {
  const labels = bands.map(
    (limit, i) => `${i === 0 ? 0 : (bands[i - 1] ?? 0) + 1}–${limit}`,
  );
  labels.push(`${(bands[bands.length - 1] ?? 0) + 1}+`);
  return labels;
}

/** Which band an age in days falls in; the last index is everything older. */
export function stockAgeBand(days: number, bands: readonly number[]): number {
  const i = bands.findIndex((limit) => days <= limit);
  return i === -1 ? bands.length : i;
}

export const StockAgeQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** Only parts holding stock in this band or an older one. */
  band: z.coerce.number().int().min(0).max(STOCK_AGE_MAX_BANDS).optional(),
});
export type StockAgeQuery = z.infer<typeof StockAgeQuery>;

export const StockAgeRow = z.object({
  item: ReportItem,
  onShelf: z.string(),
  /** Quantity in each band, youngest first. */
  bands: z.array(z.string()),
  oldestDays: z.int(),
  averageDays: z.int(),
  /** Some of it is opening stock, so its real age may be higher. */
  atLeast: z.boolean(),
});
export type StockAgeRow = z.infer<typeof StockAgeRow>;
export const StockAgeReport = z.object({
  limits: z.array(z.int()),
  items: z.array(StockAgeRow),
  truncated: z.boolean(),
});
export type StockAgeReport = z.infer<typeof StockAgeReport>;

export const StockAgeSettingsDto = z.object({
  bands: z.array(z.int()),
  version: z.int(),
});
export type StockAgeSettingsDto = z.infer<typeof StockAgeSettingsDto>;
export const StockAgeSettingsInput = z.strictObject({
  bands: z
    .array(z.coerce.number().int().min(1).max(STOCK_AGE_MAX_DAYS))
    .min(2)
    .max(STOCK_AGE_MAX_BANDS)
    .refine(
      (b) => b.every((d, i) => i === 0 || d > (b[i - 1] ?? 0)),
      'Each limit must be more than the one before',
    ),
  version: z.int(),
});
export type StockAgeSettingsInput = z.infer<typeof StockAgeSettingsInput>;

export const STOCK_LAYER_SOURCES = [
  'GRN',
  'OPENING',
  'RETURN',
  'COUNT',
  'OTHER',
] as const;
const AgeDoc = z.object({
  type: z.string(),
  id: z.uuid(),
  number: z.string().nullable(),
});
export const ItemAgeLayer = z.object({
  id: z.uuid(),
  agedFrom: z.string(),
  days: z.int(),
  atLeast: z.boolean(),
  source: z.enum(STOCK_LAYER_SOURCES),
  doc: AgeDoc,
  qtyIn: z.string(),
  qtyLeft: z.string(),
});
export type ItemAgeLayer = z.infer<typeof ItemAgeLayer>;
export const ItemAgeUse = z.object({
  id: z.uuid(),
  usedAt: z.string(),
  movement: z.enum(MOVEMENT_TYPES),
  doc: AgeDoc,
  qty: z.string(),
  returnedQty: z.string(),
  daysInStore: z.int(),
});
export type ItemAgeUse = z.infer<typeof ItemAgeUse>;
export const ItemAgeQuery = PageParams;
export const ItemAge = z.object({
  limits: z.array(z.int()),
  shelf: z.array(ItemAgeLayer),
  out: pageOf(ItemAgeUse),
});
export type ItemAge = z.infer<typeof ItemAge>;
