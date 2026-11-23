import { describe, expect, it } from 'vitest';
import { type AodPrint, aodCopyCells, aodRows, renderAod } from './aod-pdf';
import { customerPartNo } from './customer-parts';

const print: AodPrint = {
  number: 'AOD/DIR/26/0001',
  typeLabel: 'Direct sale',
  date: new Date('2026-11-18T04:30:00Z'),
  mrnNumber: 'MRN/PRT/26/0001',
  department: 'Parts Sales',
  customer: 'Test customer',
  jobNumber: null,
  deliverTo: null,
  vehicleNo: null,
  notes: null,
  issuedBy: 'Stores',
  lines: [
    {
      partNo: '1R-0750',
      requestedPartNo: null,
      description: 'Fuel filter',
      bin: 'A-01-01-A',
      qty: '2',
      uom: 'PCS',
      customerPartNo: 'CUS-0007-00012',
      bundleId: null,
    },
  ],
  bundles: [],
};

describe('AOD copies', () => {
  it('shows DAX part numbers and bins on the DAX copy', () => {
    expect(aodCopyCells('dax', print)).toEqual([
      ['1', '1R-0750', 'Fuel filter', 'A-01-01-A', '2', 'PCS'],
    ]);
  });

  it('shows only the customer part number on the customer copy', () => {
    const [cells] = aodCopyCells('customer', print);
    expect(cells).toEqual(['1', 'CUS-0007-00012', 'Fuel filter', '2', 'PCS']);
    expect(cells).not.toContain('1R-0750');
    expect(cells).not.toContain('A-01-01-A');
  });

  it('renders both copies as PDF', async () => {
    for (const copy of ['dax', 'customer'] as const) {
      const pdf = await renderAod(print, copy);
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

it('notes the older number supplied for the one asked for', () => {
  const supplied = {
    ...print,
    lines: [{ ...print.lines[0], requestedPartNo: '1R-1808' }],
  };
  expect(aodCopyCells('dax', supplied)[0]?.[1]).toBe(
    '1R-1808 (supplied as 1R-0750)',
  );
});

it('prints a bundle as a heading with its parts under it on both copies', () => {
  const base = print.lines[0] as AodPrint['lines'][number];
  const kit: AodPrint = {
    ...print,
    bundles: [
      {
        id: 'b1',
        name: '500-hr kit',
        sets: 2,
        customerPartNo: 'CUS-0007-00014',
      },
    ],
    lines: [
      { ...base, bundleId: 'b1' },
      {
        ...base,
        partNo: '1R-1808',
        description: 'Oil filter',
        qty: '2',
        customerPartNo: 'CUS-0007-00002',
        bundleId: 'b1',
      },
      { ...base, partNo: 'LF9009', description: 'Loose part' },
    ],
  };
  const customer = aodRows('customer', kit);
  expect(customer.map((r) => r.kind)).toEqual([
    'heading',
    'part',
    'part',
    'line',
  ]);
  expect(customer[0]?.cells).toEqual([
    '1',
    'CUS-0007-00014',
    '500-hr kit',
    '2',
    'SET',
  ]);
  expect(customer[1]?.cells.slice(0, 3)).toEqual(['', '', '·  Fuel filter']);
  expect(customer[3]?.cells[0]).toBe('2');
  const dax = aodRows('dax', kit);
  expect(dax[0]?.cells).toEqual(['1', '', '500-hr kit', '', '2', 'SET']);
  expect(dax[2]?.cells[1]).toBe('1R-1808');
});

describe('customer part numbers', () => {
  it('pads the running number after the customer code', () => {
    expect(customerPartNo('CUS-0007', 12)).toBe('CUS-0007-00012');
    expect(customerPartNo('CUS-0007', 123456)).toBe('CUS-0007-123456');
  });
});
