import {
  CODE128_PATTERNS,
  code128Modules,
  code128Values,
  looksLikeSerial,
  normalizeSerial,
  SERIAL_PATTERN,
} from '@dax/inventory-contract';
import { describe, expect, it } from 'vitest';
import { groupSerial, renderSerialLabels, serialSlot } from '../serial-labels';
import { isBulkUom, serialHash, unitsOf } from './serials';

describe('serial numbers', () => {
  const parts = [
    '1R-0750',
    'Caterpillar',
    'GRN/FOR/26/0041',
    '1',
    '2',
    'GOOD',
    '2026-11-20T06:00:00.000Z',
  ];

  it('hashes the receipt data into 16 Crockford characters, the same every time', () => {
    const a = serialHash(parts);
    expect(a).toMatch(SERIAL_PATTERN);
    expect(serialHash(parts)).toBe(a);
    expect(serialHash(parts, 1)).not.toBe(a);
    expect(serialHash([...parts.slice(0, 4), '3', ...parts.slice(5)])).not.toBe(
      a,
    );
  });

  it('gives whole units one serial each and a bulk line one serial', () => {
    expect(unitsOf('PCS', '3').map((u) => u.unitNo)).toEqual([1, 2, 3]);
    expect(unitsOf('PCS', '0')).toEqual([]);
    expect(isBulkUom('L')).toBe(true);
    expect(unitsOf('L', '200.5')).toEqual([{ unitNo: 1, qty: '200.5' }]);
  });

  it('reads serials typed with spaces, dashes or lower case', () => {
    expect(normalizeSerial('7k3q m9x2-hbr4 wd8n')).toBe('7K3QM9X2HBR4WD8N');
    expect(looksLikeSerial('7k3q m9x2 hbr4 wd8n')).toBe(true);
    expect(looksLikeSerial('1R-0750')).toBe(false);
    expect(looksLikeSerial('7K3QM9X2HBR4WD8I')).toBe(false);
    expect(groupSerial('7K3QM9X2HBR4WD8N')).toBe('7K3Q M9X2 HBR4 WD8N');
  });
});

describe('Code 128', () => {
  it('has 107 distinct symbols of 11 modules, and a 13-module Stop', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((t, d) => t + Number(d), 0);
      expect(sum).toBe(i === 106 ? 13 : 11);
    });
  });

  it('adds Start B, the mod-103 check symbol and Stop', () => {
    // P=48 J=42 J=42 1=17 2=18 3=19 C=35: (104 + 48 + 84 + 126 + 68 + 90 + 114 + 245) mod 103 = 55
    expect(code128Values('PJJ123C')).toEqual([
      104, 48, 42, 42, 17, 18, 19, 35, 55, 106,
    ]);
    expect(code128Modules('7K3QM9X2HBR4WD8N')).toBe(18 * 11 + 13);
  });
});

describe('serial label sheet', () => {
  it('lays 30 labels on a sheet and starts after the skipped ones', () => {
    expect(serialSlot(0)).toEqual({ page: 0, xMm: 0, yMm: 0 });
    expect(serialSlot(4).xMm).toBe(70);
    expect(serialSlot(29).yMm).toBeCloseTo(267.3);
    expect(serialSlot(30)).toEqual({ page: 1, xMm: 0, yMm: 0 });
  });

  it('renders a PDF page per 30 labels', async () => {
    const label = {
      serial: '7K3QM9X2HBR4WD8N',
      partNo: '1R-0750',
      brand: 'Caterpillar',
      description: 'Fuel filter element',
      footer: 'GRN/FOR/26/0041 · 1 of 3',
      damaged: false,
    };
    const pdf = await renderSerialLabels(Array(31).fill(label), 0);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  });
});
