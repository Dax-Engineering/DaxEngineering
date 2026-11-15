import { describe, expect, it } from 'vitest';
import { pairPayload, parsePairPayload } from './phone-scan';

describe('phone pairing QR code', () => {
  const token = 'Ab3dEf6hIj9kLm2oPq5sTu8w';

  it('round-trips the link token and code', () => {
    expect(parsePairPayload(pairPayload(token, '042731'))).toEqual({
      linkToken: token,
      code: '042731',
    });
  });

  it('rejects anything that is not a DAX pairing code', () => {
    expect(parsePairPayload('https://example.com/p')).toBeNull();
    expect(parsePairPayload('8901234567890')).toBeNull();
    expect(parsePairPayload(`DAXPAIR:${token}:12345`)).toBeNull();
    expect(parsePairPayload(`DAXPAIR:${token}:123456:x`)).toBeNull();
    expect(parsePairPayload(`OTHER:${token}:123456`)).toBeNull();
  });
});
