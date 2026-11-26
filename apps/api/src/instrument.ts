import * as Sentry from '@sentry/nestjs';
import { ClsServiceManager } from 'nestjs-cls';
import { z } from 'zod';
import { PRIVATE_DATA_COLLECTION, scrubEvent } from '@dax/util';

const blankAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const SentryEnv = z.object({
  NODE_ENV: blankAsUnset(z.string()),
  SENTRY_DSN: blankAsUnset(z.url()),
  SENTRY_ENVIRONMENT: blankAsUnset(z.string().min(1).max(64)),
  SENTRY_RELEASE: blankAsUnset(z.string().min(1).max(200)),
});

function currentRequestId(): string | undefined {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive() ? cls.getId() : undefined;
}

// Imported first by main.ts and worker.ts. Without SENTRY_DSN nothing is sent anywhere.
const env = SentryEnv.safeParse(process.env);
if (env.success && env.data.SENTRY_DSN) {
  Sentry.init({
    dsn: env.data.SENTRY_DSN,
    environment:
      env.data.SENTRY_ENVIRONMENT ?? env.data.NODE_ENV ?? 'development',
    release: env.data.SENTRY_RELEASE,
    dataCollection: PRIVATE_DATA_COLLECTION,
    beforeSend: (event) => scrubEvent(event, currentRequestId()),
  });
}
