// What a scanned code can tell us about a part before anyone types anything.
//
// - Shop barcodes (EAN-13, EAN-8, UPC-A, and GTIN-14 on cartons) hold a
//   worldwide product number with a check digit at the end.
// - GS1 logistics labels hold that number after the "(01)" field, followed by
//   batch or date fields; scanners may send them with a "]C1" or "]d2" prefix
//   and invisible group separators.
// - Many spare parts carry a barcode that is just the part number.

const AIM_PREFIX = /^\][A-Za-z][0-9]/;
// GS1 group separator (ASCII 29), sent between variable-length fields.
const GROUP_SEPARATOR = String.fromCharCode(29);

/** GS1 mod-10 check: the last digit must match the others. */
export function validGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return false;
  }
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/**
 * The product number inside a code, as 14 digits, or null if it has none.
 * UPC-A 012345678905, EAN-13 0012345678905 and GTIN-14 00012345678905 are the
 * same product, so all come back the same.
 */
export function extractGtin(raw: string): string | null {
  const code = raw
    .trim()
    .replace(AIM_PREFIX, '')
    .replaceAll(GROUP_SEPARATOR, '');
  const gs1 =
    /^\(01\)(\d{14})/.exec(code) ?? /^01(\d{14})(?:\d|$|\()/.exec(code);
  const digits = gs1 ? gs1[1] : /^\d{8}$|^\d{12,14}$/.test(code) ? code : null;
  if (!digits || !validGtin(digits)) return null;
  return digits.padStart(14, '0');
}

/**
 * Every usual way the same product number is written (GTIN-14, EAN-13,
 * UPC-A, EAN-8), so a barcode saved in one form is found from any other.
 */
export function gtinForms(gtin14: string): string[] {
  const forms = new Set([gtin14, gtin14.slice(1)]);
  if (gtin14.startsWith('00')) forms.add(gtin14.slice(2));
  if (gtin14.startsWith('000000')) forms.add(gtin14.slice(6));
  return [...forms];
}

/** The shortest usual form: 13 digits (EAN), or 12 for UPC, 8 for EAN-8. */
export function displayGtin(gtin14: string): string {
  if (gtin14.startsWith('000000')) return gtin14.slice(6);
  return gtin14.startsWith('0') ? gtin14.slice(1) : gtin14;
}

/**
 * Codes sharing a manufacturer's GS1 company prefix usually come from the same
 * maker. The prefix length varies (6-11 digits); 7 is a safe common start.
 */
export function companyPrefix(gtin14: string): string {
  return gtin14.slice(1, 8);
}

const PART_LIKE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{1,38}[A-Za-z0-9]$/;

/** A code that looks like a printed part number (not a URL or a long blob). */
export function partNumberFrom(raw: string): string | null {
  const code = raw.trim();
  if (extractGtin(code) || !PART_LIKE.test(code)) return null;
  if (!/\d/.test(code)) return null;
  return code.toUpperCase();
}
