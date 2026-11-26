import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AppName } from '@dax/platform-contract';

export interface ServerConfig {
  apiUrl: string;
  internalToken: string;
  publicOrigin: string;
  /**
   * Addresses browser requests may come from: the public origin, plus in
   * development the phone tunnel (`<APP>_PHONE_ORIGIN`, set by pnpm dev:phone).
   */
  trustedOrigins: string[];
}

export function readServerConfig(
  app: AppName,
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const names = {
    apiUrl: 'API_INTERNAL_URL',
    internalToken: `INTERNAL_TOKEN_${app.toUpperCase()}`,
    publicOrigin: `${app.toUpperCase()}_ORIGIN`,
  };
  const missing = Object.values(names).filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing server environment: ${missing.join(', ')}`);
  }
  const publicOrigin = env[names.publicOrigin] as string;
  const phone = env[`${app.toUpperCase()}_PHONE_ORIGIN`];
  const dev = env['NODE_ENV'] !== 'production';
  return {
    apiUrl: env[names.apiUrl] as string,
    internalToken: env[names.internalToken] as string,
    publicOrigin,
    trustedOrigins: dev && phone ? [publicOrigin, phone] : [publicOrigin],
  };
}

export function appCookies(app: AppName, cookieHeader: string | null): string {
  if (!cookieHeader) return '';
  const prefixes = [`dax-${app}.`, `__Secure-dax-${app}.`];
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => prefixes.some((p) => part.startsWith(p)))
    .join('; ');
}

/** The leftmost X-Forwarded-For entry is whatever the client sent; Traefik sets X-Real-Ip and appends on the right. */
export function clientIp(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded || null;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(headers: Headers): string {
  const incoming = headers.get('x-request-id');
  return incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function forwardHeaders(
  app: AppName,
  config: ServerConfig,
  incoming: Headers,
): Headers {
  const headers = new Headers();
  headers.set('x-internal-token', config.internalToken);
  headers.set('x-request-id', requestId(incoming));
  const cookies = appCookies(app, incoming.get('cookie'));
  if (cookies) headers.set('cookie', cookies);
  const ip = clientIp(incoming);
  if (ip) headers.set('x-dax-client-ip', ip);
  const agent = incoming.get('user-agent');
  if (agent) headers.set('user-agent', agent.slice(0, 512));
  return headers;
}
