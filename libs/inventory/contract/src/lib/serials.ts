import { z } from 'zod';
import { pageOf, PageParams } from '@dax/contracts';

/** Crockford base32: digits and letters without I, L, O and U. */
export const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SERIAL_LENGTH = 16;
export const SERIAL_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
export const SERIAL_LABELS_PER_SHEET = 30;
export const SERIAL_LABELS_MAX = 1500;

/** Normalises what a person or scanner typed: upper case, no spaces or dashes. */
export function normalizeSerial(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

export function looksLikeSerial(value: string): boolean {
  return SERIAL_PATTERN.test(normalizeSerial(value));
}

export const SERIAL_SOURCES = ['GRN', 'EXISTING'] as const;
export const SERIAL_CONDITIONS = ['GOOD', 'DAMAGED'] as const;
export const SERIAL_STATUSES = ['ACTIVE', 'VOID'] as const;

const Ref = z.object({
  id: z.uuid(),
  partNo: z.string(),
  brand: z.string(),
  description: z.string(),
  uom: z.string(),
});

export const SerialRow = z.object({
  id: z.uuid(),
  serial: z.string(),
  source: z.enum(SERIAL_SOURCES),
  doc: z.object({
    type: z.string(),
    id: z.uuid(),
    lineId: z.uuid().nullable(),
    number: z.string().nullable(),
  }),
  bin: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  lineNo: z.int().nullable(),
  unitNo: z.int(),
  /** Units on the same line and condition, for "2 of 3". */
  unitsOnLine: z.int(),
  qty: z.string(),
  condition: z.enum(SERIAL_CONDITIONS),
  status: z.enum(SERIAL_STATUSES),
  voidedAt: z.string().nullable(),
  receivedAt: z.string(),
  supplierName: z.string().nullable(),
  printCount: z.int(),
  lastPrintedAt: z.string().nullable(),
});
export type SerialRow = z.infer<typeof SerialRow>;

export const SerialDto = SerialRow.extend({ item: Ref });
export type SerialDto = z.infer<typeof SerialDto>;

export const SerialQuery = PageParams.extend({
  status: z.enum(['ACTIVE', 'VOID', 'ALL']).default('ACTIVE'),
  unprinted: z.enum(['true', 'false']).optional(),
});
export type SerialQuery = z.infer<typeof SerialQuery>;
export const SerialPage = pageOf(SerialRow).extend({
  unprinted: z.int(),
});
export type SerialPage = z.infer<typeof SerialPage>;

/** One line's serials on a posted GRN. */
export const GrnLineSerial = z.object({
  id: z.uuid(),
  serial: z.string(),
  unitNo: z.int(),
  qty: z.string(),
  condition: z.enum(SERIAL_CONDITIONS),
  status: z.enum(SERIAL_STATUSES),
  printCount: z.int(),
});
export type GrnLineSerial = z.infer<typeof GrnLineSerial>;

/** Which serials to print: pick one scope. */
export const SerialLabelRequest = z
  .strictObject({
    serialIds: z.array(z.uuid()).max(SERIAL_LABELS_MAX).optional(),
    grnId: z.uuid().optional(),
    grnLineId: z.uuid().optional(),
    itemId: z.uuid().optional(),
    binIds: z.array(z.uuid()).max(500).optional(),
    zoneId: z.uuid().optional(),
    /** Only serials never printed before. */
    unprinted: z.boolean().default(false),
    skip: z
      .int()
      .min(0)
      .max(SERIAL_LABELS_PER_SHEET - 1)
      .default(0),
  })
  .refine(
    (r) =>
      [
        r.serialIds?.length,
        r.grnId,
        r.itemId,
        r.binIds?.length,
        r.zoneId,
      ].filter(Boolean).length === 1,
    'Choose what to print.',
  );
export type SerialLabelRequest = z.infer<typeof SerialLabelRequest>;
