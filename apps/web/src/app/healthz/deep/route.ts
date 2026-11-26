import { HealthStatus } from '@dax/contracts';
import { apiUrl, readServerConfig } from '@dax/web-data-access/server';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5000;
const NO_STORE = { 'Cache-Control': 'no-store' };
const API_DOWN: HealthStatus = { status: 'degraded', checks: { api: 'down' } };

async function apiStatus(): Promise<{ ok: boolean; body: HealthStatus }> {
  const config = readServerConfig('web');
  const res = await fetch(apiUrl('/health/status', config.apiUrl), {
    headers: { 'x-internal-token': config.internalToken },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) return { ok: false, body: API_DOWN };
  const parsed = HealthStatus.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, body: API_DOWN };
  return { ok: res.ok && parsed.data.status === 'ok', body: parsed.data };
}

/** Uptime monitor target: the API, database, worker and outbox in one check. */
export async function GET(): Promise<Response> {
  const { ok, body } = await apiStatus();
  return Response.json(body, { status: ok ? 200 : 503, headers: NO_STORE });
}
