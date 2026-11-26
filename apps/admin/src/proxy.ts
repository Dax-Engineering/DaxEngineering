import { NextResponse, type NextRequest } from 'next/server';
import {
  buildCsp,
  ensureSubmitNonce,
  SUBMIT_COOKIE,
  SUBMIT_COOKIE_OPTIONS,
} from '@dax/web-data-access';

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    wasm: false,
  });
  const requestId = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('x-request-id', requestId);
  headers.set('content-security-policy', csp);
  const submitNonce = ensureSubmitNonce(request.cookies, headers);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('x-request-id', requestId);
  if (submitNonce) {
    response.cookies.set(SUBMIT_COOKIE, submitNonce, SUBMIT_COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|healthz|monitoring).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
