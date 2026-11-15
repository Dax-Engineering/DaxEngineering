import { describe, expect, it } from 'vitest';
import {
  companyPrefix,
  displayGtin,
  extractGtin,
  gtinForms,
  partNumberFrom,
  validGtin,
} from './barcode-info';

describe('barcode info', () => {
  it('checks the GTIN check digit', () => {
    expect(validGtin('4006381333931')).toBe(true); // EAN-13
    expect(validGtin('4006381333932')).toBe(false);
    expect(validGtin('036000291452')).toBe(true); // UPC-A
    expect(validGtin('96385074')).toBe(true); // EAN-8
    expect(validGtin('12345')).toBe(false);
  });

  it('reads the same product from UPC, EAN and GTIN-14 forms', () => {
    const gtin = '00036000291452';
    expect(extractGtin('036000291452')).toBe(gtin);
    expect(extractGtin('0036000291452')).toBe(gtin);
    expect(extractGtin(gtin)).toBe(gtin);
    expect(displayGtin(gtin)).toBe('0036000291452');
  });

  it('reads the product from GS1 box labels', () => {
    expect(extractGtin('(01)04006381333931(10)ABC123')).toBe('04006381333931');
    expect(extractGtin(']C10104006381333931\x1d10ABC123')).toBe(
      '04006381333931',
    );
    expect(extractGtin('010400638133393117261231')).toBe('04006381333931');
  });

  it('ignores codes without a valid product number', () => {
    expect(extractGtin('1R-0750')).toBeNull();
    expect(extractGtin('4006381333932')).toBeNull();
    expect(extractGtin('https://x.test/q/i/abc')).toBeNull();
  });

  it('spots part numbers, not URLs or product numbers', () => {
    expect(partNumberFrom(' 1r-0750 ')).toBe('1R-0750');
    expect(partNumberFrom('LGEP 2/1')).toBe('LGEP 2/1');
    expect(partNumberFrom('4006381333931')).toBeNull();
    expect(partNumberFrom('https://x.test/q/i/abc')).toBeNull();
    expect(partNumberFrom('FILTER')).toBeNull();
  });

  it('lists every form of the same product number', () => {
    expect(gtinForms('00036000291452')).toEqual([
      '00036000291452',
      '0036000291452',
      '036000291452',
    ]);
  });

  it('takes a company prefix for brand guesses', () => {
    expect(companyPrefix('04006381333931')).toBe('4006381');
  });
});
