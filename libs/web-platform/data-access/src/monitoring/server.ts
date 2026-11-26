import type { Instrumentation } from 'next';
import { z } from 'zod';
import type { AppName } from '@dax/platform-contract';
import { PRIVATE_DATA_COLLECTION, scrubEvent } from '@dax/util';

export * from './shared';

const blankAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const MonitoringEnv = z.object({
  dsn: blankAsUnset(z.url()),
  environment: blankAsUnset(z.string().min(1).max(64)),
  release: blankAsUnset(z.string().min(1).max(200)),
  nodeEnv: blankAsUnset(z.string()),
});

export interface MonitoringConfig {
  dsn: string;
  environment: string;
  release?: string;
}

/** Error reporting settings for one app; null (report nothing) unless SENTRY_DSN_<APP> is set. */
export function monitoringConfig(
  app: AppName,
  env: Record<string, string | undefined> = process.env,
): MonitoringConfig | null {
  const parsed = MonitoringEnv.safeParse({
    dsn: env[`SENTRY_DSN_${app.toUpperCase()}`],
    environment: env['SENTRY_ENVIRONMENT'],
    release: env['SENTRY_RELEASE'],
    nodeEnv: env['NODE_ENV'],
  });
  if (!parsed.success || !parsed.data.dsn) return null;
  const { dsn, environment, release, nodeEnv } = parsed.data;
  return { dsn, environment: environment ?? nodeEnv ?? 'development', release };
}

/** Contents of the page's monitoring data block, escaped for an inline script tag. */
export function browserMonitoringJson(
  app: AppName,
  requestId: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const config = monitoringConfig(app, env);
  if (!config) return null;
  return JSON.stringify({ ...config, app, requestId }).replace(/</g, '\\u003c');
}

function nodeConfig(app: AppName): MonitoringConfig | null {
  return process.env['NEXT_RUNTIME'] === 'nodejs'
    ? monitoringConfig(app)
    : null;
}

/** The `register` and `onRequestError` hooks for an app's instrumentation.ts. */
export function serverMonitoring(app: AppName) {
  async function register(): Promise<void> {
    const config = nodeConfig(app);
    if (!config) return;
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      ...config,
      dataCollection: PRIVATE_DATA_COLLECTION,
      beforeSend: (event) => scrubEvent(event),
    });
    Sentry.getGlobalScope().setTag('service', app);
  }

  const onRequestError: Instrumentation.onRequestError = async (
    error,
    request,
    context,
  ) => {
    if (!nodeConfig(app)) return;
    const Sentry = await import('@sentry/nextjs');
    const id = request.headers['x-request-id'];
    Sentry.withScope((scope) => {
      if (typeof id === 'string') scope.setTag('request_id', id);
      Sentry.captureRequestError(error, request, context);
    });
  };

  return { register, onRequestError };
}

/** POST handler for the browser's error-report tunnel; 404 while reporting is off. */
export function monitoringTunnel(app: AppName) {
  return async (request: Request): Promise<Response> => {
    if (!nodeConfig(app)) return new Response(null, { status: 404 });
    const { POST } = await import('@sentry/nextjs/tunnel');
    return POST(request);
  };
}
