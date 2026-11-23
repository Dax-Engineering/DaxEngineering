import { z } from 'zod';
import { OptionalText, PageQuery, pageOf, Qty } from '@dax/contracts';

const ItemRef = z.object({
  id: z.uuid(),
  partNo: z.string(),
  brand: z.string(),
  description: z.string(),
  uom: z.string(),
});
const Ref = z.object({ id: z.uuid(), name: z.string() });
const DocRef = z.object({ id: z.uuid(), number: z.string().nullable() });
const Stamp = z
  .object({ by: z.string().nullable(), at: z.string() })
  .nullable();
const PositiveQty = Qty.refine((q) => Number(q) > 0, 'Must be more than 0');

export const HOLD_STATUSES = ['ACTIVE', 'CONVERTED', 'RELEASED'] as const;
export const MRN_SUBTYPES = ['PRT', 'SRV', 'SAL'] as const;
export const MRN_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'CHECKED',
  'READY',
  'PARTLY_ISSUED',
  'ISSUED',
  'CLOSED',
  'SHORT_CLOSED',
  'CANCELLED',
] as const;
export const AOD_TYPES = ['SER', 'REP', 'INS', 'BRK', 'DIR', 'HIR'] as const;
export const AOD_STATUSES = [
  'PICKING',
  'PENDING_APPROVAL',
  'APPROVED',
  'ISSUED',
  'SIGNED',
  'CANCELLED',
] as const;

export const HoldInput = z.strictObject({
  departmentId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  reason: OptionalText(300),
  lines: z
    .array(z.strictObject({ itemId: z.uuid(), qty: PositiveQty }))
    .min(1)
    .max(100),
});
export type HoldInput = z.infer<typeof HoldInput>;
export const HoldRelease = z.strictObject({
  version: z.int(),
  reason: OptionalText(300),
});
export const HoldConvert = z.strictObject({
  version: z.int(),
  subtype: z.enum(MRN_SUBTYPES),
  jobNumber: OptionalText(40),
  customerPo: OptionalText(40),
  quotationRef: OptionalText(40),
  notes: OptionalText(1000),
});
export type HoldConvert = z.infer<typeof HoldConvert>;

export const HoldSummary = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(HOLD_STATUSES),
  department: Ref,
  customer: Ref.nullable().optional(),
  lineCount: z.int(),
  createdAt: z.string(),
});
export type HoldSummary = z.infer<typeof HoldSummary>;
export const HoldPage = pageOf(HoldSummary);
export type HoldPage = z.infer<typeof HoldPage>;
export const HoldDto = HoldSummary.extend({
  reason: z.string().nullable(),
  convertedMrn: DocRef.nullable(),
  released: Stamp,
  version: z.int(),
  lines: z.array(
    z.object({ id: z.uuid(), lineNo: z.int(), item: ItemRef, qty: z.string() }),
  ),
});
export type HoldDto = z.infer<typeof HoldDto>;
export const HoldQuery = PageQuery.extend({
  status: z.enum([...HOLD_STATUSES, 'ALL']).default('ACTIVE'),
});
export type HoldQuery = z.infer<typeof HoldQuery>;

const mrnHeader = {
  subtype: z.enum(MRN_SUBTYPES),
  departmentId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  jobNumber: OptionalText(40),
  customerPo: OptionalText(40),
  quotationRef: OptionalText(40),
  notes: OptionalText(1000),
};
export const MrnLineInput = z.strictObject({
  id: z.uuid().optional(),
  itemId: z.uuid(),
  qty: PositiveQty,
  notes: OptionalText(300),
});
/** A bundle on an MRN: a saved bundle (its parts copied in) or a one-off set. */
export const MrnBundleInput = z.strictObject({
  bundleId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(80),
  qtySets: z.coerce.number().int().min(1).max(10_000),
  lines: z
    .array(z.strictObject({ itemId: z.uuid(), qtyPerSet: PositiveQty }))
    .min(1)
    .max(100),
});
export type MrnBundleInput = z.infer<typeof MrnBundleInput>;
const someLines = (v: { lines?: unknown[]; bundles?: unknown[] }) =>
  (v.lines?.length ?? 0) + (v.bundles?.length ?? 0) > 0;
export const MrnInput = z
  .strictObject({
    ...mrnHeader,
    lines: z.array(MrnLineInput).max(200).default([]),
    bundles: z.array(MrnBundleInput).max(50).optional(),
  })
  .refine(someLines, {
    message: 'Add at least one part or bundle.',
    path: ['lines'],
  });
export type MrnInput = z.infer<typeof MrnInput>;
export const MrnUpdate = z
  .strictObject({
    ...mrnHeader,
    lines: z.array(MrnLineInput).max(200),
    bundles: z.array(MrnBundleInput).max(50),
  })
  .partial()
  .extend({ version: z.int() });
export type MrnUpdate = z.infer<typeof MrnUpdate>;
export const MrnTransition = z.strictObject({ version: z.int() });
export const MrnShortClose = z.strictObject({
  version: z.int(),
  reason: z.string().trim().min(5).max(300),
});
export const MrnAllocate = z.strictObject({
  version: z.int(),
  lines: z
    .array(z.strictObject({ mrnLineId: z.uuid(), qty: PositiveQty }))
    .max(200)
    .optional(),
});
export type MrnAllocate = z.infer<typeof MrnAllocate>;

export const MrnSummary = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  subtype: z.enum(MRN_SUBTYPES),
  status: z.enum(MRN_STATUSES),
  department: Ref,
  customer: Ref.nullable().optional(),
  jobNumber: z.string().nullable(),
  lineCount: z.int(),
  waitingLines: z.int(),
  createdAt: z.string(),
});
export type MrnSummary = z.infer<typeof MrnSummary>;
export const MrnPage = pageOf(MrnSummary);
export type MrnPage = z.infer<typeof MrnPage>;
export const MrnLineDto = z.object({
  id: z.uuid(),
  lineNo: z.int(),
  item: ItemRef,
  qtyRequested: z.string(),
  qtyReserved: z.string(),
  qtyIssued: z.string(),
  qtyShortClosed: z.string(),
  qtyWaiting: z.string(),
  freeNow: z.string(),
  notes: z.string().nullable(),
  /** The MRN bundle this part belongs to; null for a loose part. */
  bundleId: z.uuid().nullable(),
  qtyPerSet: z.string().nullable(),
  /** Storage bins holding any number of the part's family; `itemId` says which. */
  bins: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      qty: z.string(),
      itemId: z.uuid(),
      partNo: z.string(),
    }),
  ),
  /** What is reserved per family number, oldest first. */
  reservedBy: z.array(z.object({ item: ItemRef, qty: z.string() })),
  /** The family's current number when this line names an older one. */
  supersededBy: ItemRef.nullable(),
});
export type MrnLineDto = z.infer<typeof MrnLineDto>;
export const MrnDto = MrnSummary.extend({
  customerPo: z.string().nullable(),
  quotationRef: z.string().nullable(),
  notes: z.string().nullable(),
  hold: z.object({ id: z.uuid(), number: z.string() }).nullable(),
  submitted: Stamp,
  checked: Stamp,
  closed: Stamp,
  closeReason: z.string().nullable(),
  version: z.int(),
  lines: z.array(MrnLineDto),
  /** Bundles on the MRN; their parts are the lines with a matching `bundleId`. */
  bundles: z.array(
    z.object({
      id: z.uuid(),
      bundleId: z.uuid().nullable(),
      name: z.string(),
      qtySets: z.int(),
      /** Complete sets reserved and not yet issued. */
      setsReady: z.int(),
      setsIssued: z.int(),
      customerPartNo: z.string().nullable(),
    }),
  ),
  aods: z.array(
    DocRef.extend({ type: z.enum(AOD_TYPES), status: z.enum(AOD_STATUSES) }),
  ),
});
export type MrnDto = z.infer<typeof MrnDto>;
export const MrnQuery = PageQuery.extend({
  status: z.enum([...MRN_STATUSES, 'OPEN', 'WAITING', 'ALL']).default('OPEN'),
});
export type MrnQuery = z.infer<typeof MrnQuery>;

export const AodCreate = z.strictObject({
  mrnId: z.uuid(),
  type: z.enum(AOD_TYPES),
  deliverTo: OptionalText(120),
  vehicleNo: OptionalText(20),
  notes: OptionalText(1000),
});
export type AodCreate = z.infer<typeof AodCreate>;
export const AodLineInput = z.strictObject({
  id: z.uuid().optional(),
  mrnLineId: z.uuid(),
  /** The family number picked; defaults to the MRN line's own part. */
  itemId: z.uuid().optional(),
  binId: z.uuid().nullable(),
  qty: PositiveQty,
  scanned: z.boolean().default(false),
});
export type AodLineInput = z.infer<typeof AodLineInput>;
export const AodUpdate = z.strictObject({
  version: z.int(),
  type: z.enum(AOD_TYPES).optional(),
  deliverTo: OptionalText(120),
  vehicleNo: OptionalText(20),
  notes: OptionalText(1000),
  lines: z.array(AodLineInput).max(300).optional(),
});
export type AodUpdate = z.infer<typeof AodUpdate>;
export const AodTransition = z.strictObject({ version: z.int() });
export const AodReject = z.strictObject({
  version: z.int(),
  reason: z.string().trim().min(5).max(300),
});
export type AodReject = z.infer<typeof AodReject>;
export const AodSign = z.strictObject({
  version: z.int(),
  attachmentId: z.uuid(),
});

export const AodSummary = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  type: z.enum(AOD_TYPES),
  status: z.enum(AOD_STATUSES),
  mrn: DocRef,
  department: Ref,
  customer: Ref.nullable().optional(),
  lineCount: z.int(),
  createdAt: z.string(),
  issuedAt: z.string().nullable(),
});
export type AodSummary = z.infer<typeof AodSummary>;
export const AodPage = pageOf(AodSummary);
export type AodPage = z.infer<typeof AodPage>;
export const AodDto = AodSummary.extend({
  deliverTo: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  notes: z.string().nullable(),
  submitted: Stamp,
  approved: Stamp,
  rejected: Stamp,
  rejectReason: z.string().nullable(),
  /** Bundles on this AOD, in whole sets; their parts are the lines with a matching `bundleId`. */
  bundles: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      sets: z.int(),
      customerPartNo: z.string().nullable(),
    }),
  ),
  /** Whether the viewer may approve or reject this AOD now. */
  canApprove: z.boolean(),
  issued: Stamp,
  signed: Stamp,
  signedFileId: z.uuid().nullable(),
  version: z.int(),
  lines: z.array(
    z.object({
      id: z.uuid(),
      mrnLineId: z.uuid(),
      item: ItemRef,
      bin: z.object({ id: z.uuid(), code: z.string() }).nullable(),
      qty: z.string(),
      reservedForLine: z.string(),
      scanned: z.boolean(),
      /** The customer's own number for the part; null without a customer or when hidden. */
      customerPartNo: z.string().nullable(),
      /** The MRN line's part when a different number of its family is supplied. */
      requestedItem: ItemRef.nullable(),
      /** The MRN bundle this line is a part of; null for a loose part. */
      bundleId: z.uuid().nullable(),
    }),
  ),
});
export type AodDto = z.infer<typeof AodDto>;
export const AodQuery = PageQuery.extend({
  status: z.enum([...AOD_STATUSES, 'OPEN', 'ALL']).default('OPEN'),
});
export type AodQuery = z.infer<typeof AodQuery>;

export const IssuingSummary = z.object({
  mrnDrafts: z.int(),
  mrnToCheck: z.int(),
  mrnWaiting: z.int(),
  mrnReady: z.int(),
  picking: z.int(),
  awaitingApproval: z.int(),
  approved: z.int(),
  awaitingSignature: z.int(),
  activeHolds: z.int(),
});
export type IssuingSummary = z.infer<typeof IssuingSummary>;
