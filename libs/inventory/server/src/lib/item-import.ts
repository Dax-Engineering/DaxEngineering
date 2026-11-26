import { parse as parseCsv } from 'csv-parse/sync';
import {
  BarcodeInput,
  ITEM_CSV_COLUMNS,
  ITEM_CSV_MAX_ROWS,
  type ItemImportMode,
  ItemInput,
  MAX_TAGS,
  normalizePartNo,
  Price,
  Tag,
  UOMS,
} from '@dax/inventory-contract';
import type { ImportResult } from '@dax/contracts';
import { isWhole } from './stock-math';

type Column = (typeof ITEM_CSV_COLUMNS)[number];
/** Added later; files made before them still import. */
const OPTIONAL_COLUMNS: readonly Column[] = [
  'supplier',
  'tags',
  'pre_cost_price',
  'selling_price',
];
export type ImportError = ImportResult['errors'][number];

/** An item the file may update, with the values its blank cells keep. */
export interface ExistingItem {
  id: string;
  version: number;
  partNo: string;
  archived: boolean;
  description: string;
  uom: string;
  minQty: string;
  defaultBinId: string | null;
  notes: string | null;
  supplierId: string | null;
  tags: string[];
  preCostPrice: string | null;
  sellingPrice: string | null;
  machineModelIds: string[];
  barcodes: string[];
}

export interface ImportLookups {
  brands: ReadonlyMap<string, { id: string; active: boolean }>;
  machineModels: ReadonlyMap<string, { id: string }>;
  suppliers: ReadonlyMap<string, { id: string; name: string; active: boolean }>;
  storageBins: ReadonlyMap<string, { id: string }>;
  existingItems: ReadonlyMap<string, ExistingItem>;
  /** Barcode → the part number it is on. */
  barcodesInUse: ReadonlyMap<string, string>;
}

export interface ImportRow {
  row: number;
  partNo: string;
  partNoNorm: string;
  brandName: string;
  description: string;
  uom: string;
  minQty: string;
  defaultBinCode: string;
  machineModelNames: string[];
  barcodes: string[];
  notes: string | null;
  supplierName: string;
  tags: string[];
  preCostPrice: string;
  sellingPrice: string;
}

export interface ValidItem {
  row: number;
  partNo: string;
  partNoNorm: string;
  brandId: string;
  description: string;
  uom: string;
  allowFraction: boolean;
  minQty: string;
  defaultBinId: string | null;
  machineModelIds: string[];
  barcodes: string[];
  notes: string | null;
  supplier: { id: string; name: string } | null;
  tags: string[];
  preCostPrice: string | null;
  sellingPrice: string | null;
}

export interface ItemChanges {
  description?: string;
  uom?: string;
  allowFraction?: boolean;
  minQty?: string;
  defaultBinId?: string;
  notes?: string;
  supplier?: { id: string; name: string };
  tags?: string[];
  preCostPrice?: string;
  sellingPrice?: string;
}

/** An existing item the file changes; only changed fields are set. */
export interface ValidUpdate {
  row: number;
  existing: ExistingItem;
  changes: ItemChanges;
  machineModelIds?: string[];
  addBarcodes: string[];
}

export interface ValidatedImport {
  items: ValidItem[];
  updates: ValidUpdate[];
  errors: ImportError[];
}

export const itemKey = (brandId: string, partNoNorm: string) =>
  `${brandId}|${partNoNorm}`;
export const nameKey = (name: string) => name.trim().toLowerCase();

const RowFields = ItemInput.pick({
  partNo: true,
  description: true,
  uom: true,
  minQty: true,
  notes: true,
});
const FIELD_ERRORS: Record<string, { column: Column; message: string }> = {
  partNo: {
    column: 'part_no',
    message: 'Part number is required (up to 60 characters).',
  },
  description: {
    column: 'description',
    message: 'Description is required (up to 200 characters).',
  },
  uom: { column: 'uom', message: 'Unknown unit.' },
  minQty: {
    column: 'min_qty',
    message: 'Minimum quantity must be a number with up to 3 decimals.',
  },
  notes: { column: 'notes', message: 'Notes can be up to 1000 characters.' },
};

const list = (value: string) =>
  value
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);

export type ReadResult =
  | { ok: true; rows: ImportRow[] }
  | { ok: false; total: number; errors: ImportError[] };

function fileError(message: string, total = 0): ReadResult {
  return { ok: false, total, errors: [{ row: 0, field: null, message }] };
}

export function readItemCsv(text: string): ReadResult {
  let records: string[][];
  try {
    records = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
  } catch (error) {
    const line = (error as { lines?: unknown }).lines;
    return fileError(
      typeof line === 'number'
        ? `The file is not valid CSV (near line ${line}).`
        : 'The file is not valid CSV.',
    );
  }
  const [header, ...data] = records;
  if (!header) return fileError('The file is empty.');
  const names = header.map((h) => h.trim().toLowerCase());
  const missing = ITEM_CSV_COLUMNS.filter(
    (c) => !names.includes(c) && !OPTIONAL_COLUMNS.includes(c),
  );
  const unknown = names.filter(
    (n) => n && !(ITEM_CSV_COLUMNS as readonly string[]).includes(n),
  );
  if (missing.length || unknown.length) {
    return fileError(
      `The header must be: ${ITEM_CSV_COLUMNS.join(',')}.` +
        (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
        (unknown.length ? ` Unknown: ${unknown.join(', ')}.` : ''),
    );
  }
  if (data.length === 0) return fileError('The file has no rows.');
  if (data.length > ITEM_CSV_MAX_ROWS) {
    return fileError(
      `At most ${ITEM_CSV_MAX_ROWS} rows per file (this one has ${data.length}).`,
      data.length,
    );
  }
  const index = Object.fromEntries(
    ITEM_CSV_COLUMNS.map((c) => [c, names.indexOf(c)]),
  ) as Record<Column, number>;
  const rows = data.map((cells, i): ImportRow => {
    const cell = (c: Column) =>
      index[c] < 0 ? '' : (cells[index[c]] ?? '').trim();
    const partNo = cell('part_no');
    return {
      row: i + 2,
      partNo,
      partNoNorm: normalizePartNo(partNo),
      brandName: cell('brand'),
      description: cell('description'),
      uom: cell('uom').toUpperCase(),
      minQty: cell('min_qty'),
      defaultBinCode: cell('default_bin').toUpperCase(),
      machineModelNames: list(cell('machine_models')),
      barcodes: list(cell('barcodes')),
      notes: cell('notes') || null,
      supplierName: cell('supplier'),
      tags: list(cell('tags')),
      preCostPrice: cell('pre_cost_price').replace(/,/g, ''),
      sellingPrice: cell('selling_price').replace(/,/g, ''),
    };
  });
  return { ok: true, rows };
}

const sameNumber = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Number(a) === Number(b);

type ItemValues = Omit<ValidItem, 'row' | 'partNo' | 'partNoNorm' | 'brandId'>;

function changesOf(
  existing: ExistingItem,
  next: ItemValues,
): Omit<ValidUpdate, 'row' | 'existing'> {
  const changes: ItemChanges = {};
  if (next.description !== existing.description)
    changes.description = next.description;
  if (next.uom !== existing.uom) {
    changes.uom = next.uom;
    changes.allowFraction = next.allowFraction;
  }
  if (!sameNumber(next.minQty, existing.minQty)) changes.minQty = next.minQty;
  if (next.defaultBinId && next.defaultBinId !== existing.defaultBinId)
    changes.defaultBinId = next.defaultBinId;
  if (next.notes && next.notes !== existing.notes) changes.notes = next.notes;
  if (next.supplier && next.supplier.id !== existing.supplierId)
    changes.supplier = next.supplier;
  if (next.tags.length && next.tags.join('|') !== existing.tags.join('|'))
    changes.tags = next.tags;
  if (
    next.preCostPrice &&
    !sameNumber(next.preCostPrice, existing.preCostPrice)
  )
    changes.preCostPrice = next.preCostPrice;
  if (
    next.sellingPrice &&
    !sameNumber(next.sellingPrice, existing.sellingPrice)
  )
    changes.sellingPrice = next.sellingPrice;
  const models =
    next.machineModelIds.length > 0 &&
    [...next.machineModelIds].sort().join() !==
      [...existing.machineModelIds].sort().join();
  return {
    changes,
    ...(models ? { machineModelIds: next.machineModelIds } : {}),
    addBarcodes: next.barcodes.filter((c) => !existing.barcodes.includes(c)),
  };
}

/**
 * In `upsert` mode a row whose brand and part number already exist updates
 * that item; its blank cells keep the current values.
 */
export function validateImport(
  rows: readonly ImportRow[],
  lookups: ImportLookups,
  mode: ItemImportMode = 'add',
): ValidatedImport {
  const errors: ImportError[] = [];
  const items: ValidItem[] = [];
  const updates: ValidUpdate[] = [];
  const seenItems = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();

  for (const r of rows) {
    const fail = (field: Column | null, message: string) =>
      errors.push({ row: r.row, field, message });
    const before = errors.length;

    const brand = r.brandName
      ? lookups.brands.get(nameKey(r.brandName))
      : undefined;
    const key = brand && r.partNoNorm ? itemKey(brand.id, r.partNoNorm) : null;
    const found = key ? lookups.existingItems.get(key) : undefined;
    const existing = mode === 'upsert' ? found : undefined;

    const parsed = RowFields.safeParse({
      partNo: r.partNo,
      description: r.description || existing?.description || '',
      uom: r.uom || existing?.uom || '',
      minQty: r.minQty || existing?.minQty || '0',
      notes: r.notes ?? undefined,
    });
    if (!parsed.success) {
      const keys = new Set(
        parsed.error.issues.map((i) => String(i.path[0] ?? '')),
      );
      for (const key of keys) {
        const known = FIELD_ERRORS[key];
        fail(known?.column ?? null, known?.message ?? 'Check this row.');
      }
    }
    if (r.partNo && !r.partNoNorm) {
      fail('part_no', 'The part number needs at least one letter or digit.');
    }

    if (!r.brandName) fail('brand', 'Brand is required.');
    else if (!brand) fail('brand', `Unknown brand "${r.brandName}".`);
    else if (!brand.active && !existing)
      fail('brand', `Brand "${r.brandName}" is inactive.`);

    const uom = parsed.success
      ? UOMS.find((u) => u.code === parsed.data.uom)
      : undefined;
    if (
      uom &&
      parsed.success &&
      !uom.fraction &&
      !isWhole(parsed.data.minQty)
    ) {
      fail(
        'min_qty',
        `Minimum quantity must be a whole number for ${uom.code}.`,
      );
    }

    const bin = r.defaultBinCode
      ? lookups.storageBins.get(r.defaultBinCode)
      : undefined;
    if (r.defaultBinCode && !bin) {
      fail('default_bin', `No active storage bin "${r.defaultBinCode}".`);
    }

    const modelIds: string[] = [];
    if (r.machineModelNames.length > 50) {
      fail('machine_models', 'At most 50 machine models per item.');
    }
    for (const name of r.machineModelNames) {
      const model = lookups.machineModels.get(nameKey(name));
      if (!model) fail('machine_models', `Unknown machine model "${name}".`);
      else if (!modelIds.includes(model.id)) modelIds.push(model.id);
    }

    const codes = [...new Set(r.barcodes)];
    for (const code of codes) {
      const usedOn = lookups.barcodesInUse.get(code);
      if (!BarcodeInput.shape.code.safeParse(code).success) {
        fail('barcodes', `Barcode "${code}" is not valid.`);
      } else if (usedOn !== undefined && !existing?.barcodes.includes(code)) {
        fail(
          'barcodes',
          `Barcode "${code}" is already on another part: ${usedOn}.`,
        );
      } else if (seenBarcodes.has(code)) {
        fail(
          'barcodes',
          `Barcode "${code}" is also on row ${seenBarcodes.get(code)}.`,
        );
      }
    }

    const supplier = r.supplierName
      ? lookups.suppliers.get(nameKey(r.supplierName))
      : undefined;
    if (r.supplierName && !supplier) {
      fail('supplier', `Unknown supplier "${r.supplierName}".`);
    } else if (supplier && !supplier.active) {
      fail('supplier', `Supplier "${r.supplierName}" is inactive.`);
    }

    const tags: string[] = [];
    if (r.tags.length > MAX_TAGS) fail('tags', `At most ${MAX_TAGS} tags.`);
    for (const raw of r.tags) {
      const tag = Tag.safeParse(raw);
      if (!tag.success) fail('tags', `Tag "${raw}" is not valid.`);
      else if (!tags.includes(tag.data)) tags.push(tag.data);
    }

    const price = (value: string, column: Column, label: string) => {
      if (!value) return null;
      if (!Price.safeParse(value).success) {
        fail(column, `${label} must be an amount like 1250 or 1250.50.`);
        return null;
      }
      return value;
    };
    const preCostPrice = price(
      r.preCostPrice,
      'pre_cost_price',
      'Pre-costing price',
    );
    const sellingPrice = price(
      r.sellingPrice,
      'selling_price',
      'Selling price',
    );

    if (key) {
      if (found && mode === 'add') {
        fail('part_no', 'This part number already exists for this brand.');
      } else if (existing?.archived) {
        fail(
          'part_no',
          'This part is archived. Restore it before updating it from a file.',
        );
      } else if (seenItems.has(key)) {
        fail('part_no', `Duplicate of row ${seenItems.get(key)}.`);
      } else {
        seenItems.set(key, r.row);
      }
    }
    for (const code of codes)
      if (!seenBarcodes.has(code)) seenBarcodes.set(code, r.row);

    if (errors.length > before || !parsed.success || !brand || !uom) continue;
    const values: ItemValues = {
      description: parsed.data.description,
      uom: uom.code,
      allowFraction: uom.fraction,
      minQty: parsed.data.minQty,
      defaultBinId: bin?.id ?? null,
      machineModelIds: modelIds,
      barcodes: codes,
      notes: parsed.data.notes ?? null,
      supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      tags,
      preCostPrice,
      sellingPrice,
    };
    if (existing) {
      const update = changesOf(existing, values);
      if (
        Object.keys(update.changes).length ||
        update.machineModelIds ||
        update.addBarcodes.length
      ) {
        updates.push({ row: r.row, existing, ...update });
      }
      continue;
    }
    items.push({
      row: r.row,
      partNo: parsed.data.partNo,
      partNoNorm: r.partNoNorm,
      brandId: brand.id,
      ...values,
    });
  }
  return { items, updates, errors };
}
