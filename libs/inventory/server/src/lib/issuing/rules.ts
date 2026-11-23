import { inventoryManifest } from '@dax/inventory-contract';
import type { Prisma } from '@dax/platform-db';
import { conflict } from '../common';
import { dec, type DecimalLike } from '../stock-math';

export type HoldStatus = 'ACTIVE' | 'CONVERTED' | 'RELEASED';
export type MrnStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'CHECKED'
  | 'READY'
  | 'PARTLY_ISSUED'
  | 'ISSUED'
  | 'CLOSED'
  | 'SHORT_CLOSED'
  | 'CANCELLED';
export type AodStatus =
  | 'PICKING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ISSUED'
  | 'SIGNED'
  | 'CANCELLED';

export type MrnAction =
  | 'edit'
  | 'submit'
  | 'check'
  | 'allocate'
  | 'cancel'
  | 'short_close'
  | 'pick'
  | 'issue';
export type AodAction =
  | 'edit'
  | 'submit'
  | 'withdraw'
  | 'approve'
  | 'reject'
  | 'issue'
  | 'cancel'
  | 'sign';

export const MRN_ALLOWED_FROM: Record<MrnAction, MrnStatus[]> = {
  edit: ['DRAFT'],
  submit: ['DRAFT'],
  check: ['SUBMITTED'],
  allocate: ['CHECKED', 'READY', 'PARTLY_ISSUED'],
  cancel: ['DRAFT', 'SUBMITTED', 'CHECKED', 'READY'],
  short_close: ['CHECKED', 'READY', 'PARTLY_ISSUED'],
  pick: ['CHECKED', 'READY', 'PARTLY_ISSUED'],
  issue: ['CHECKED', 'READY', 'PARTLY_ISSUED'],
};

export const AOD_ALLOWED_FROM: Record<AodAction, AodStatus[]> = {
  edit: ['PICKING'],
  submit: ['PICKING'],
  withdraw: ['PENDING_APPROVAL'],
  approve: ['PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL'],
  issue: ['APPROVED'],
  cancel: ['PICKING', 'PENDING_APPROVAL', 'APPROVED'],
  sign: ['ISSUED'],
};

/** Not yet issued: at most one per request, and cancelled with it. */
export const UNISSUED_AOD_STATUSES: AodStatus[] = [
  'PICKING',
  'PENDING_APPROVAL',
  'APPROVED',
];

export const OPEN_MRN_STATUSES: MrnStatus[] = [
  'SUBMITTED',
  'CHECKED',
  'READY',
  'PARTLY_ISSUED',
  'ISSUED',
];
export const OPEN_AOD_STATUSES: AodStatus[] = [
  ...UNISSUED_AOD_STATUSES,
  'ISSUED',
];

const MRN_REFUSALS: Record<MrnAction, string> = {
  edit: 'Only a draft MRN can be changed.',
  submit: 'Only a draft MRN can be submitted.',
  check: 'Only a submitted MRN can be checked.',
  allocate: 'Stock can only be assigned to a checked MRN that is still open.',
  cancel: 'Only an MRN with nothing issued can be cancelled.',
  short_close: 'Only a checked MRN that is still open can be closed short.',
  pick: 'Check the MRN before picking its stock.',
  issue: 'This MRN is no longer open for issuing.',
};

const AOD_REFUSALS: Record<AodAction, string> = {
  edit: 'Only an AOD that is still being picked can be changed.',
  submit: 'Only an AOD that is still being picked can be sent for approval.',
  withdraw: 'Only an AOD waiting for approval can be taken back.',
  approve: 'Only an AOD waiting for approval can be approved.',
  reject: 'Only an AOD waiting for approval can be rejected.',
  issue: 'Only an approved AOD can be issued.',
  cancel: 'An AOD that has been issued cannot be cancelled.',
  sign: 'Only an issued AOD awaiting its signed copy can be signed.',
};

export function assertMrnAction(action: MrnAction, status: MrnStatus): void {
  if (!MRN_ALLOWED_FROM[action].includes(status)) {
    conflict('INVALID_STATE', MRN_REFUSALS[action]);
  }
}

export function assertAodAction(action: AodAction, status: AodStatus): void {
  if (!AOD_ALLOWED_FROM[action].includes(status)) {
    conflict('INVALID_STATE', AOD_REFUSALS[action]);
  }
}

export function assertHoldActive(status: HoldStatus): void {
  if (status !== 'ACTIVE') {
    conflict(
      'INVALID_STATE',
      status === 'CONVERTED'
        ? 'This hold has already been turned into an MRN.'
        : 'This hold has already been released.',
    );
  }
}

export interface MrnLineQty {
  qtyRequested: DecimalLike;
  qtyIssued: DecimalLike;
  qtyShortClosed: DecimalLike;
}

const atLeastZero = (v: Prisma.Decimal) => (v.gt(0) ? v : dec(0));

export function outstandingQty(line: MrnLineQty): Prisma.Decimal {
  return atLeastZero(
    dec(line.qtyRequested)
      .minus(dec(line.qtyIssued))
      .minus(dec(line.qtyShortClosed)),
  );
}

export function waitingQty(
  line: MrnLineQty,
  reserved: DecimalLike,
): Prisma.Decimal {
  return atLeastZero(outstandingQty(line).minus(dec(reserved)));
}

export function toReserve(
  line: MrnLineQty,
  reserved: DecimalLike,
  free: DecimalLike,
): Prisma.Decimal {
  const want = waitingQty(line, reserved);
  const available = atLeastZero(dec(free));
  return want.lt(available) ? want : available;
}

export function isFullyIssued(lines: readonly MrnLineQty[]): boolean {
  return lines.every((l) => outstandingQty(l).isZero());
}

export function statusAfterIssue(lines: readonly MrnLineQty[]): MrnStatus {
  return isFullyIssued(lines) ? 'ISSUED' : 'PARTLY_ISSUED';
}

export function canClose(
  status: MrnStatus,
  aods: readonly { status: AodStatus }[],
): boolean {
  return (
    status === 'ISSUED' &&
    aods.every((a) => a.status === 'SIGNED' || a.status === 'CANCELLED')
  );
}

export function overReserved(
  lines: readonly { mrnLineId: string; qty: DecimalLike }[],
  reserved: ReadonlyMap<string, Prisma.Decimal>,
): string | null {
  const totals = new Map<string, Prisma.Decimal>();
  for (const l of lines) {
    totals.set(
      l.mrnLineId,
      (totals.get(l.mrnLineId) ?? dec(0)).plus(dec(l.qty)),
    );
  }
  for (const [lineId, total] of totals) {
    if (total.gt(reserved.get(lineId) ?? dec(0))) return lineId;
  }
  return null;
}

export interface BinStockOption {
  binId: string;
  qty: DecimalLike;
}

export function suggestBin(
  defaultBinId: string | null,
  options: readonly BinStockOption[],
  needed: DecimalLike,
): string | null {
  const byDefault = options.find((o) => o.binId === defaultBinId);
  if (byDefault && dec(byDefault.qty).gte(dec(needed))) return byDefault.binId;
  let best: BinStockOption | null = null;
  for (const o of options) {
    if (dec(o.qty).gt(0) && (!best || dec(o.qty).gt(dec(best.qty)))) best = o;
  }
  return best?.binId ?? null;
}

const AOD_SERIES = inventoryManifest.numberSeries.find(
  (s) => s.docType === 'AOD',
);

export function aodTypeLabel(type: string): string {
  const subtypes: Record<string, string> | undefined =
    AOD_SERIES && 'subtypes' in AOD_SERIES ? AOD_SERIES.subtypes : undefined;
  return subtypes?.[type] ?? type;
}
