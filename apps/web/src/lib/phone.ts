import 'server-only';

/** Cookie that holds a paired phone's scan token, scoped to its /p/<link> path. */
export const PHONE_COOKIE = 'dax-phone-scan';

/**
 * The address a phone can open: the HTTPS tunnel from `pnpm dev:phone` in
 * development, the real web address in production. Null when there is none.
 */
export function phoneOrigin(): string | null {
  const tunnel = process.env['WEB_PHONE_ORIGIN'];
  if (tunnel && process.env['NODE_ENV'] !== 'production') return tunnel;
  const origin = process.env['WEB_ORIGIN'];
  return origin?.startsWith('https://') ? origin : null;
}
