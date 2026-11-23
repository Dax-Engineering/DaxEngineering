import { BIN_KINDS, UOMS } from '@dax/inventory-contract';

const number = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 3 });

export function formatQty(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? number.format(n) : value;
}

const money = new Intl.NumberFormat('en-LK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Rupee amount, or a dash when there is none. */
export function formatMoney(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `Rs ${money.format(n)}` : value;
}

export function trimQty(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** 23/11/2026, 11:53 AM in Colombo time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : dateTime.format(d).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
}

export type BinKind = (typeof BIN_KINDS)[number];

export const BIN_KIND_LABELS: Record<BinKind, string> = {
  STORAGE: 'Storage',
  RECEIVING: 'Receiving',
  QUARANTINE: 'Quarantine',
  WARRANTY: 'Warranty',
};

export const BIN_KIND_OPTIONS = BIN_KINDS.map((k) => ({
  value: k,
  label: BIN_KIND_LABELS[k],
}));

export const UOM_OPTIONS = UOMS.map((u) => ({
  value: u.code,
  label: `${u.label} (${u.code})`,
}));

export function uomLabel(code: string): string {
  return UOMS.find((u) => u.code === code)?.label ?? code;
}

const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDay(value: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : day.format(d);
}

export function allowsFraction(uom: string): boolean {
  return UOMS.find((u) => u.code === uom)?.fraction ?? false;
}

const COUNT = new Intl.NumberFormat('en-LK');

/** A whole-number count with thousands separators, e.g. 1,204. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}
