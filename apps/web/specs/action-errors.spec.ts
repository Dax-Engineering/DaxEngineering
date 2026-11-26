import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  BinInput,
  GrnCreate,
  HoldInput,
  ItemInput,
  MrnInput,
  ReturnInput,
  WarrantyClose,
  WarrantySend,
  WarrantyTagInput,
} from '@dax/inventory-contract';
import { invalid } from '../src/lib/action-errors';

vi.mock('server-only', () => ({}));

function fieldsOf(schema: z.ZodType, input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error('expected the input to be rejected');
  return invalid(parsed.error).fields ?? {};
}

const ID = '7d3f2a4e-8c1b-4f5a-9e2d-1b3c4d5e6f70';
const VERSION = 1;

describe('form field messages', () => {
  it.each([
    [
      'GRN supplier',
      GrnCreate,
      { supplierId: '' },
      'supplierId',
      'Choose a supplier',
    ],
    [
      'MRN department',
      MrnInput,
      { subtype: 'PRT', departmentId: '', lines: [{ itemId: ID, qty: '1' }] },
      'departmentId',
      'Choose a department',
    ],
    [
      'hold department',
      HoldInput,
      { departmentId: '', lines: [{ itemId: ID, qty: '1' }] },
      'departmentId',
      'Choose a department',
    ],
    [
      'return department',
      ReturnInput,
      {
        departmentId: '',
        reason: 'Not needed',
        lines: [{ itemId: ID, qty: '1', condition: 'DAMAGED' }],
      },
      'departmentId',
      'Choose the department returning the parts',
    ],
    [
      'warranty part',
      WarrantyTagInput,
      { itemId: '', fault: 'Motor burnt out' },
      'itemId',
      'Choose the failed part',
    ],
    [
      'warranty supplier',
      WarrantySend,
      { version: VERSION, supplierId: '' },
      'supplierId',
      'Choose a supplier',
    ],
    [
      'warranty outcome',
      WarrantyClose,
      { version: VERSION, outcome: '' },
      'outcome',
      'Choose an outcome',
    ],
    [
      'item brand',
      ItemInput,
      { partNo: 'A1', brandId: null, description: 'Seal', uom: 'PCS' },
      'brandId',
      'Choose a brand',
    ],
    [
      'item unit',
      ItemInput,
      { partNo: 'A1', brandId: ID, description: 'Seal', uom: '' },
      'uom',
      'Choose a unit',
    ],
    [
      'bin zone',
      BinInput,
      { zoneId: '', rack: '1', shelf: '1', position: 'A' },
      'zoneId',
      'Choose a zone',
    ],
  ])('asks to choose the %s', (_name, schema, input, key, message) => {
    expect(fieldsOf(schema, input)[key]).toBe(message);
  });

  it('never shows the validator wording', () => {
    const fields = fieldsOf(
      z.object({
        id: z.uuid(),
        kind: z.enum(['A', 'B']),
        code: z.string().regex(/^\d+$/),
        flag: z.boolean(),
      }),
      { id: 'x', kind: 'C', code: 'x', flag: 'yes' },
    );
    expect(fields).toEqual({
      id: 'Check this field',
      kind: 'Check this field',
      code: 'Check this field',
      flag: 'Check this field',
    });
  });

  it('keeps the plain wording for lengths and email', () => {
    const fields = fieldsOf(
      z.object({
        name: z.string().min(1),
        reason: z.string().min(5),
        note: z.string().max(3),
        email: z.email(),
      }),
      { name: '', reason: 'ab', note: 'abcd', email: 'nope' },
    );
    expect(fields).toEqual({
      name: 'Required',
      reason: 'At least 5',
      note: 'At most 3',
      email: 'Enter a valid email',
    });
  });

  it('passes written messages through', () => {
    const fields = fieldsOf(
      z.object({
        rack: z.string().regex(/^\d+$/, 'Rack number, e.g. 1 or 01'),
        fault: z.string().min(5, 'Describe the fault'),
      }),
      { rack: 'x', fault: 'ab' },
    );
    expect(fields).toEqual({
      rack: 'Rack number, e.g. 1 or 01',
      fault: 'Describe the fault',
    });
  });
});
