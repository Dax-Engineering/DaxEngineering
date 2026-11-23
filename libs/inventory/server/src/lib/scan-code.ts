import { LABEL_TOKEN_PATTERN } from '@dax/inventory-contract';

export type LabelKind = 'item' | 'bin';

export type ScanCode =
  { kind: 'text'; value: string; maybeToken: boolean } | { kind: 'empty' };

const BIN_CODE = /^[A-Z]{1,3}-\d{2,3}-\d{2}-[A-Z0-9]{1,3}$/;

export function parseScanCode(raw: string): ScanCode {
  const value = raw.trim();
  if (!value) return { kind: 'empty' };
  return { kind: 'text', value, maybeToken: LABEL_TOKEN_PATTERN.test(value) };
}

export function looksLikeBinCode(value: string): boolean {
  return BIN_CODE.test(value.toUpperCase());
}
