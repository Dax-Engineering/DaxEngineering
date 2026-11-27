import { describe, expect, it } from 'vitest';
import {
  ensureSubmitNonce,
  isSubmitNonce,
  newSubmitNonce,
  SUBMIT_COOKIE,
  submitNonceFrom,
} from './submit-nonce';

function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (name: string) =>
      values.has(name) ? { value: values.get(name) as string } : undefined,
    set: (name: string, value: string) => values.set(name, value),
    toString: () =>
      [...values].map(([name, value]) => `${name}=${value}`).join('; '),
  };
}

describe('submit nonce', () => {
  it('makes valid, distinct nonces', () => {
    const a = newSubmitNonce();
    expect(isSubmitNonce(a)).toBe(true);
    expect(newSubmitNonce()).not.toBe(a);
  });

  it('adds a nonce to a request without one', () => {
    const headers = new Headers({ cookie: 'other=1' });
    const fresh = ensureSubmitNonce(jar({ other: '1' }), headers);
    expect(isSubmitNonce(fresh)).toBe(true);
    expect(headers.get('cookie')).toBe(`other=1; ${SUBMIT_COOKIE}=${fresh}`);
  });

  it('keeps an existing nonce', () => {
    const nonce = newSubmitNonce();
    const headers = new Headers();
    expect(
      ensureSubmitNonce(jar({ [SUBMIT_COOKIE]: nonce }), headers),
    ).toBeNull();
    expect(headers.get('cookie')).toBeNull();
  });

  it('replaces a malformed nonce', () => {
    const fresh = ensureSubmitNonce(
      jar({ [SUBMIT_COOKIE]: 'bad value' }),
      new Headers(),
    );
    expect(isSubmitNonce(fresh)).toBe(true);
  });

  it('reads the nonce from a cookie header', () => {
    const nonce = newSubmitNonce();
    expect(submitNonceFrom(`a=1; ${SUBMIT_COOKIE}=${nonce}; b=2`)).toBe(nonce);
    expect(submitNonceFrom('a=1')).toBeNull();
    expect(submitNonceFrom(null)).toBeNull();
    expect(submitNonceFrom(`${SUBMIT_COOKIE}=short`)).toBeNull();
  });
});
