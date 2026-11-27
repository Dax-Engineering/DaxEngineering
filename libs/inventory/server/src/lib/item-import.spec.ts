import { ITEM_CSV_COLUMNS, ITEM_CSV_MAX_ROWS } from '@dax/inventory-contract';
import {
  type ExistingItem,
  type ImportLookups,
  readItemCsv,
  validateImport,
} from './item-import';
import { ItemsService } from './items.service';
import { asPrisma, fakeAudit, fakePolicy, fakeStore } from './testing';

const HEADER = ITEM_CSV_COLUMNS.join(',');
const CAT = '0190a000-0000-7000-8000-0000000000c1';
const MODEL = '0190a000-0000-7000-8000-0000000000d1';
const BIN = '0190a000-0000-7000-8000-0000000000b1';
const SUP = '0190a000-0000-7000-8000-0000000000e1';

const lookups: ImportLookups = {
  brands: new Map([
    ['caterpillar', { id: CAT, active: true }],
    ['old brand', { id: 'x', active: false }],
  ]),
  machineModels: new Map([['320d', { id: MODEL }]]),
  suppliers: new Map([
    [
      'lanka filter house',
      { id: SUP, name: 'Lanka Filter House', active: true },
    ],
    ['closed traders', { id: 'y', name: 'Closed Traders', active: false }],
  ]),
  storageBins: new Map([['A-01-01-A', { id: BIN }]]),
  existingItems: new Map([[`${CAT}|EXISTING1`, existingItem()]]),
  barcodesInUse: new Map([
    ['5000000000001', 'OTHER-1'],
    ['5000000000009', 'EXISTING-1'],
  ]),
};

function existingItem(over: Partial<ExistingItem> = {}): ExistingItem {
  return {
    id: 'item-1',
    version: 3,
    partNo: 'EXISTING-1',
    archived: false,
    description: 'Old description',
    uom: 'PCS',
    minQty: '2',
    defaultBinId: null,
    notes: 'Keep dry',
    supplierId: null,
    tags: ['filters'],
    preCostPrice: '100',
    sellingPrice: null,
    machineModelIds: [],
    barcodes: ['5000000000009'],
    ...over,
  };
}

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

function validate(text: string, mode: 'add' | 'upsert' = 'add') {
  const read = readItemCsv(text);
  if (!read.ok) throw new Error(read.errors[0]?.message);
  return validateImport(read.rows, lookups, mode);
}

describe('item CSV validation', () => {
  it('accepts a good row and resolves names case-insensitively', () => {
    const { items, errors } = validate(
      csv(
        '1R-0750,CATERPILLAR,Fuel filter,pcs,2,a-01-01-a,320D | 320d,5012345678900|5012345678901,Keep dry',
      ),
    );
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({
      row: 2,
      partNo: '1R-0750',
      partNoNorm: '1R0750',
      brandId: CAT,
      uom: 'PCS',
      allowFraction: false,
      minQty: '2',
      defaultBinId: BIN,
      machineModelIds: [MODEL],
      barcodes: ['5012345678900', '5012345678901'],
      notes: 'Keep dry',
    });
  });

  it('reads supplier, tags and prices, and checks them', () => {
    const { items, errors } = validate(
      csv(
        'P-1,Caterpillar,Filter,PCS,0,,,,,lanka filter house,Filters | Fast Moving|filters,"1,250.5",1999',
        'P-2,Caterpillar,Filter,PCS,0,,,,,Nobody Ltd,bad#tag,12.345,',
        'P-3,Caterpillar,Filter,PCS,0,,,,,Closed Traders,,,',
      ),
    );
    expect(items[0]).toMatchObject({
      supplier: { id: SUP, name: 'Lanka Filter House' },
      tags: ['filters', 'fast moving'],
      preCostPrice: '1250.5',
      sellingPrice: '1999',
    });
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [3, 'supplier'],
      [3, 'tags'],
      [3, 'pre_cost_price'],
      [4, 'supplier'],
    ]);
  });

  it('still accepts a file made before the supplier, tag and price columns', () => {
    const read = readItemCsv(
      [
        'part_no,brand,description,uom,min_qty,default_bin,machine_models,barcodes,notes',
        'P-9,Caterpillar,A,PCS,0,,,,',
      ].join('\n'),
    );
    expect(read.ok).toBe(true);
  });

  it('defaults an empty minimum to zero and allows fractions for metres', () => {
    const { items, errors } = validate(
      csv(
        'HOSE-1,Caterpillar,Hose,M,,,,,',
        'HOSE-2,Caterpillar,Hose,M,1.5,,,,',
      ),
    );
    expect(errors).toEqual([]);
    expect(items.map((i) => i.minQty)).toEqual(['0', '1.5']);
  });

  it('reports each problem with its row and column', () => {
    const { items, errors } = validate(
      csv(
        'P-1,Unknown,Thing,PCS,1,,,,',
        'P-2,Caterpillar,Thing,BAG,1,,,,',
        'P-3,Caterpillar,Thing,PCS,1.5,,,,',
        'P-4,Caterpillar,Thing,PCS,1,Z-99-99-Z,,,',
        'P-5,Caterpillar,Thing,PCS,1,,Nope,,',
        'P-6,Caterpillar,Thing,PCS,1,,,5000000000001,',
        'existing-1,Caterpillar,Thing,PCS,1,,,,',
        'P-8,Old brand,Thing,PCS,1,,,,',
        '---,Caterpillar,Thing,PCS,1,,,,',
        'P-10,Caterpillar,,PCS,1,,,,',
      ),
    );
    expect(items).toEqual([]);
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [2, 'brand'],
      [3, 'uom'],
      [4, 'min_qty'],
      [5, 'default_bin'],
      [6, 'machine_models'],
      [7, 'barcodes'],
      [8, 'part_no'],
      [9, 'brand'],
      [10, 'part_no'],
      [11, 'description'],
    ]);
    expect(errors[0]?.message).toBe('Unknown brand "Unknown".');
  });

  it('catches duplicates inside the file', () => {
    const { errors } = validate(
      csv(
        '1R-0750,Caterpillar,A,PCS,0,,,111,',
        '1r 0750,caterpillar,B,PCS,0,,,222,',
        '2R-1,Caterpillar,C,PCS,0,,,111,',
      ),
    );
    expect(errors).toEqual([
      { row: 3, field: 'part_no', message: 'Duplicate of row 2.' },
      { row: 4, field: 'barcodes', message: 'Barcode "111" is also on row 2.' },
    ]);
  });

  it('names the part a used barcode is on', () => {
    const { errors } = validate(
      csv('P-1,Caterpillar,A,PCS,0,,,5000000000001,'),
    );
    expect(errors[0]?.message).toBe(
      'Barcode "5000000000001" is already on another part: OTHER-1.',
    );
  });

  it('refuses existing parts when only adding', () => {
    const { errors } = validate(csv('existing-1,Caterpillar,New,PCS,1,,,,'));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe('part_no');
  });

  it('updates existing parts in upsert mode, keeping blank cells', () => {
    const { items, updates, errors } = validate(
      csv(
        'EXISTING 1,Caterpillar,,,,,320D,5000000000009|5000000000010,,lanka filter house,,,1500',
        'P-NEW,Caterpillar,New part,PCS,0,,,,',
      ),
      'upsert',
    );
    expect(errors).toEqual([]);
    expect(items.map((i) => i.partNo)).toEqual(['P-NEW']);
    expect(updates).toEqual([
      {
        row: 2,
        existing: expect.objectContaining({ id: 'item-1' }),
        changes: {
          supplier: { id: SUP, name: 'Lanka Filter House' },
          sellingPrice: '1500',
        },
        machineModelIds: [MODEL],
        addBarcodes: ['5000000000010'],
      },
    ]);
  });

  it('skips unchanged rows and checks the unit against the kept minimum', () => {
    const { updates, errors } = validate(
      csv('EXISTING-1,Caterpillar,Old description,,2.0,,,,', ''),
      'upsert',
    );
    expect(errors).toEqual([]);
    expect(updates).toEqual([]);
    const fraction = validate(
      csv('EXISTING-1,Caterpillar,,,1.5,,,,'),
      'upsert',
    );
    expect(fraction.errors.map((e) => e.field)).toEqual(['min_qty']);
  });

  it('refuses to update an archived part', () => {
    const read = readItemCsv(csv('EXISTING-1,Caterpillar,X,,,,,,'));
    if (!read.ok) throw new Error('bad csv');
    const { errors } = validateImport(
      read.rows,
      {
        ...lookups,
        existingItems: new Map([
          [`${CAT}|EXISTING1`, existingItem({ archived: true })],
        ]),
      },
      'upsert',
    );
    expect(errors[0]?.message).toMatch(/archived/);
  });

  it('rejects a wrong header, an empty file and too many rows', () => {
    const header = readItemCsv('part,brand\nx,y');
    expect(header.ok).toBe(false);
    expect(readItemCsv('').ok).toBe(false);
    expect(readItemCsv(HEADER).ok).toBe(false);
    const rows = Array.from(
      { length: ITEM_CSV_MAX_ROWS + 1 },
      (_, i) => `P${i},Caterpillar,X,PCS,0,,,,`,
    );
    const big = readItemCsv(csv(...rows));
    expect(big).toMatchObject({ ok: false, total: ITEM_CSV_MAX_ROWS + 1 });
  });

  it('reports malformed CSV instead of throwing', () => {
    const read = readItemCsv(`${HEADER}\n"unterminated,Caterpillar`);
    expect(read.ok).toBe(false);
  });
});

describe('ItemsService.import', () => {
  function service() {
    const writes: string[] = [];
    const tx = {
      item: {
        createManyAndReturn: async (args: {
          data: { brandId: string; partNoNorm: string }[];
        }) => {
          writes.push('item');
          return args.data.map((d, i) => ({
            id: `id-${i}`,
            brandId: d.brandId,
            partNoNorm: d.partNoNorm,
          }));
        },
      },
      itemMachineModel: { createMany: async () => writes.push('models') },
      itemBarcode: { createMany: async () => writes.push('barcodes') },
    };
    const prisma = asPrisma({
      brand: {
        findMany: async () => [{ id: CAT, name: 'Caterpillar', active: true }],
      },
      machineModel: { findMany: async () => [{ id: MODEL, name: '320D' }] },
      bin: { findMany: async () => [] },
      item: { findMany: async () => [] },
      itemBarcode: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      $transaction: async (run: (t: typeof tx) => Promise<unknown>) => {
        writes.push('transaction');
        return run(tx);
      },
    });
    const audit = fakeAudit();
    return {
      items: new ItemsService(prisma, audit.service, fakeStore),
      writes,
      audit,
    };
  }
  const policy = fakePolicy(['inventory.item.import']);

  it('never writes on a dry run', async () => {
    const { items, writes } = service();
    const result = await items.import(
      policy,
      csv('P-1,Caterpillar,A,PCS,0,,320D,111,'),
      true,
    );
    expect(result).toEqual({
      dryRun: true,
      total: 1,
      created: 1,
      updated: 0,
      errors: [],
    });
    expect(writes).toEqual([]);
  });

  it('writes nothing when any row fails', async () => {
    const { items, writes } = service();
    const result = await items.import(
      policy,
      csv('P-1,Caterpillar,A,PCS,0,,,,', 'P-2,Unknown,B,PCS,0,,,,'),
      false,
    );
    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it('creates every row in one transaction', async () => {
    const { items, writes, audit } = service();
    const result = await items.import(
      policy,
      csv('P-1,Caterpillar,A,PCS,0,,320D,111,', 'P-2,Caterpillar,B,PCS,0,,,,'),
      false,
    );
    expect(result).toEqual({
      dryRun: false,
      total: 2,
      created: 2,
      updated: 0,
      errors: [],
    });
    expect(writes).toEqual(['transaction', 'item', 'models', 'barcodes']);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'imported',
        after: { count: 2, updated: 0 },
      }),
    ]);
  });

  it('needs the edit permission to update existing parts', async () => {
    const { items } = service();
    await expect(
      items.import(policy, csv('P-1,Caterpillar,A,PCS,0,,,,'), true, 'upsert'),
    ).rejects.toMatchObject({ status: 403 });
  });
});
