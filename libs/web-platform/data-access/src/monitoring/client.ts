import { z } from 'zod';
import { PRIVATE_DATA_COLLECTION, scrubEvent } from '@dax/util';
import { MONITORING_ELEMENT_ID, MONITORING_TUNNEL } from './shared';

export { MONITORING_ELEMENT_ID };

const BrowserMonitoring = z.object({
  dsn: z.url(),
  environment: z.string().min(1),
  release: z.string().optional(),
  app: z.string(),
  requestId: z.string().nullable(),
});

type Sentry = typeof import('@sentry/nextjs');
let started: Promise<Sentry> | null = null;

function parse(json: string): z.infer<typeof BrowserMonitoring> | null {
  try {
    return BrowserMonitoring.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Starts browser error reporting when the page carries a monitoring data block. */
export function startBrowserMonitoring(json: string | null | undefined): void {
  if (started || !json) return;
  const config = parse(json);
  if (!config) return;
  started = import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tunnel: MONITORING_TUNNEL,
      dataCollection: PRIVATE_DATA_COLLECTION,
      beforeSend: (event) => scrubEvent(event),
      initialScope: {
        tags: {
          service: config.app,
          ...(config.requestId ? { request_id: config.requestId } : {}),
        },
      },
    });
    return Sentry;
  });
}

/** Reports an error an error boundary caught; does nothing while reporting is off. */
export function reportClientError(error: unknown): void {
  void started?.then((Sentry) => Sentry.captureException(error));
}
