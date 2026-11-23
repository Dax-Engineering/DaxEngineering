import { z } from 'zod';
import { Qty } from '@dax/contracts';

/** How long a link can wait for a phone, and how long a paired phone scans. */
export const PHONE_SCAN_MINUTES = 15;
/** "Add 15 min" can stretch a session to at most this long after pairing. */
export const PHONE_SCAN_MAX_MINUTES = 120;
/** Wrong codes allowed before the link locks. */
export const PHONE_SCAN_MAX_ATTEMPTS = 5;

export const PHONE_SCAN_STATUSES = [
  'WAITING',
  'PAIRED',
  'ENDED',
  'LOCKED',
] as const;

/** Random token that identifies one pairing (inside the PC's QR code). */
export const PHONE_LINK_TOKEN = /^[A-Za-z0-9]{24}$/;
export const PHONE_SCAN_CODE = /^\d{6}$/;

/**
 * The PC's QR code is not a web link: it holds the pairing token and code,
 * and only the phone scanner page (/p) understands it.
 */
const PAIR_PREFIX = 'DAXPAIR';

export function pairPayload(linkToken: string, code: string): string {
  return `${PAIR_PREFIX}:${linkToken}:${code}`;
}

export function parsePairPayload(
  text: string,
): { linkToken: string; code: string } | null {
  const [prefix, linkToken = '', code = '', ...rest] = text.trim().split(':');
  if (prefix !== PAIR_PREFIX || rest.length > 0) return null;
  if (!PHONE_LINK_TOKEN.test(linkToken) || !PHONE_SCAN_CODE.test(code)) {
    return null;
  }
  return { linkToken, code };
}

/** Barcode symbology names the camera reader reports, as people say them. */
export const BARCODE_FORMAT_LABELS: Record<string, string> = {
  ean_13: 'EAN-13',
  ean_8: 'EAN-8',
  upc_a: 'UPC-A',
  upc_e: 'UPC-E',
  code_128: 'Code 128',
  code_39: 'Code 39',
  code_93: 'Code 93',
  itf: 'ITF-14',
  qr_code: 'QR code',
  data_matrix: 'Data Matrix',
  typed: 'Typed in',
};

export function barcodeFormatLabel(format: string | null | undefined): string {
  if (!format) return 'Barcode';
  return BARCODE_FORMAT_LABELS[format] ?? format.replaceAll('_', ' ');
}

export const BarcodeFormat = z.string().regex(/^[a-z0-9_]{2,24}$/);

/** What a scanned code is, worked out from its content. */
export const CODE_KINDS = ['product', 'box', 'part', 'dax', 'text'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];
export const CODE_KIND_LABELS: Record<CodeKind, string> = {
  product: 'Product number',
  box: 'Box label (GS1)',
  part: 'Part number',
  dax: 'DAX label',
  text: 'Other code',
};

const ItemRef = z.object({
  id: z.uuid(),
  partNo: z.string(),
  brand: z.string(),
  description: z.string(),
  uom: z.string(),
});

/** Returned once, when the PC starts a session: the code is never shown again. */
export const PhoneScanStart = z.object({
  id: z.uuid(),
  linkToken: z.string().regex(PHONE_LINK_TOKEN),
  code: z.string().regex(PHONE_SCAN_CODE),
  expiresAt: z.string(),
});
export type PhoneScanStart = z.infer<typeof PhoneScanStart>;

export const PhoneScanLineDto = z.object({
  id: z.uuid(),
  code: z.string(),
  item: ItemRef.nullable(),
  /** More than 1: the code matched several items. */
  matches: z.int(),
  qty: z.string(),
  lastSeenAt: z.string(),
  /** Latest label photo taken on the phone, if any. */
  photoId: z.uuid().nullable(),
  /** Symbology the camera read (null for older lines). */
  format: z.string().nullable(),
  kind: z.enum(CODE_KINDS),
  /** The product number inside the code, when it has one. */
  gtin: z.string().nullable(),
  /** Stock of the matched item in the main store. */
  stock: z
    .object({ onHand: z.string(), free: z.string(), bins: z.int() })
    .nullable(),
});
export type PhoneScanLineDto = z.infer<typeof PhoneScanLineDto>;

/** What the PC polls while the phone scans. */
export const PhoneScanView = z.object({
  id: z.uuid(),
  status: z.enum(PHONE_SCAN_STATUSES),
  expiresAt: z.string(),
  pairedAt: z.string().nullable(),
  canExtend: z.boolean(),
  lines: z.array(PhoneScanLineDto),
});
export type PhoneScanView = z.infer<typeof PhoneScanView>;

export const PhoneScanLineUpdate = z.strictObject({
  qty: Qty.refine((q) => Number(q) > 0, 'Must be more than 0'),
});
export type PhoneScanLineUpdate = z.infer<typeof PhoneScanLineUpdate>;

/** Phone side: type the PC's code to pair. */
export const PhoneScanPair = z.strictObject({
  linkToken: z.string().regex(PHONE_LINK_TOKEN),
  code: z.string().trim().regex(PHONE_SCAN_CODE, 'Enter the 6 digits'),
});
export type PhoneScanPair = z.infer<typeof PhoneScanPair>;

export const PhoneScanPaired = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    phoneToken: z.string(),
    expiresAt: z.string(),
    owner: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['wrong_code', 'locked', 'expired', 'used']),
    attemptsLeft: z.int().optional(),
  }),
]);
export type PhoneScanPaired = z.infer<typeof PhoneScanPaired>;

/** Phone side: one scanned code. */
export const PhoneScanCode = z.strictObject({
  phoneToken: z.string().min(16).max(128),
  code: z.string().trim().min(1).max(512),
  format: BarcodeFormat.optional(),
});
export type PhoneScanCode = z.infer<typeof PhoneScanCode>;

/** PC side: a code read by the PC's own camera or hand-held scanner. */
export const PhoneScanPcCode = PhoneScanCode.omit({ phoneToken: true });
export type PhoneScanPcCode = z.infer<typeof PhoneScanPcCode>;

export const PhoneScanReply = z.object({
  result: z.enum(['added', 'unknown', 'several', 'bin', 'ended']),
  line: z
    .object({
      id: z.uuid(),
      partNo: z.string().nullable(),
      brand: z.string().nullable(),
      description: z.string().nullable(),
      qty: z.string(),
    })
    .nullable(),
  expiresAt: z.string().nullable(),
});
export type PhoneScanReply = z.infer<typeof PhoneScanReply>;

/** Phone side: is my session still open? */
export const PhoneScanState = z.object({
  status: z.enum([...PHONE_SCAN_STATUSES, 'NONE']),
  expiresAt: z.string().nullable(),
  owner: z.string().nullable(),
  lines: z.int(),
});
export type PhoneScanState = z.infer<typeof PhoneScanState>;

/** PC: say which item a line is, and whether to keep the barcode on it. */
export const PhoneScanLink = z.strictObject({
  itemId: z.uuid(),
  saveBarcode: z.boolean().default(false),
});
export type PhoneScanLink = z.infer<typeof PhoneScanLink>;

/**
 * Details suggested for a scanned code: read from the barcode itself, from
 * earlier items with a similar barcode, or from an online product database.
 */
export const PhoneScanSuggestion = z.object({
  /** The product number inside the barcode (EAN/UPC/GTIN), if it has one. */
  gtin: z.string().nullable(),
  partNo: z.string().nullable(),
  brand: z.object({ id: z.uuid().nullable(), name: z.string() }).nullable(),
  description: z.string().nullable(),
  source: z.enum(['barcode', 'similar', 'online']).nullable(),
  /** When the code matched several items: the candidates. */
  matches: z.array(ItemRef),
});
export type PhoneScanSuggestion = z.infer<typeof PhoneScanSuggestion>;
