import type { ImportResult } from '@dax/contracts';
import type { ActionState } from './action-state';

export const IMPORT_KINDS = ['customers', 'suppliers', 'items'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** `upsert` also updates rows that match an existing record. */
export const IMPORT_MODES = ['add', 'upsert'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export interface ImportModeOption {
  value: ImportMode;
  label: string;
  /** Extra template notes that apply in this mode. */
  notes: string[];
}

export const IMPORT_API: Record<ImportKind, string> = {
  customers: '/parties/customers/import',
  suppliers: '/parties/suppliers/import',
  items: '/inventory/items/import',
};

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export { ImportResult } from '@dax/contracts';

export interface ImportState extends ActionState {
  result?: ImportResult;
}
