// A random value per browser, rotated after every successful save. Retrying a save whose
// answer was lost re-sends the same value, so the API replays the first result instead of
// saving twice.
export const SUBMIT_COOKIE = 'dax_submit';

export const SUBMIT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export function isSubmitNonce(
  value: string | null | undefined,
): value is string {
  return typeof value === 'string' && NONCE.test(value);
}

export function newSubmitNonce(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

interface CookieJar {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string): unknown;
  toString(): string;
}

/** Gives the request a nonce when it has none; returns the new value so the response can set it. */
export function ensureSubmitNonce(
  cookies: CookieJar,
  headers: Headers,
): string | null {
  if (isSubmitNonce(cookies.get(SUBMIT_COOKIE)?.value)) return null;
  const fresh = newSubmitNonce();
  cookies.set(SUBMIT_COOKIE, fresh);
  headers.set('cookie', cookies.toString());
  return fresh;
}

export function submitNonceFrom(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SUBMIT_COOKIE) {
      const value = rest.join('=');
      return isSubmitNonce(value) ? value : null;
    }
  }
  return null;
}
