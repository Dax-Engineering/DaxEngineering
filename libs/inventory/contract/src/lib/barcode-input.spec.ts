import { describe, expect, it } from 'vitest';
import { BarcodeInput } from './dto';

const ok = (code: string) =>
  BarcodeInput.safeParse({ code, kind: 'MANUFACTURER' }).success;

describe('barcode rules', () => {
  it('allows spaces between characters', () => {
    expect(ok('P31667701 AA')).toBe(true);
    expect(ok('1R-0750')).toBe(true);
    expect(ok('4006381333931')).toBe(true);
  });

  it('trims outside spaces and refuses odd codes', () => {
    expect(
      BarcodeInput.parse({ code: '  AB1 ', kind: 'MANUFACTURER' }).code,
    ).toBe('AB1');
    expect(ok('VO')).toBe(false);
    expect(ok('tab\there')).toBe(false);
    expect(ok('x'.repeat(65))).toBe(false);
  });
});
