import { describe, expect, it } from 'vitest';
import { browserMonitoringJson, monitoringConfig } from './server';

const DSN = 'https://public@o1.ingest.sentry.io/2';

describe('monitoringConfig', () => {
  it('is off without a DSN for the app', () => {
    expect(monitoringConfig('web', {})).toBeNull();
    expect(monitoringConfig('web', { SENTRY_DSN_WEB: '' })).toBeNull();
    expect(monitoringConfig('web', { SENTRY_DSN_ADMIN: DSN })).toBeNull();
    expect(monitoringConfig('web', { SENTRY_DSN_WEB: 'not a url' })).toBeNull();
  });

  it('reads the DSN, environment and release at runtime', () => {
    expect(
      monitoringConfig('admin', {
        SENTRY_DSN_ADMIN: DSN,
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'abc123',
      }),
    ).toEqual({ dsn: DSN, environment: 'staging', release: 'abc123' });
    expect(
      monitoringConfig('web', { SENTRY_DSN_WEB: DSN, NODE_ENV: 'production' })
        ?.environment,
    ).toBe('production');
  });
});

describe('browserMonitoringJson', () => {
  it('is null while reporting is off', () => {
    expect(browserMonitoringJson('web', 'req-12345678', {})).toBeNull();
  });

  it('carries the request id and cannot close the script tag', () => {
    const json = browserMonitoringJson('web', '</script><b>', {
      SENTRY_DSN_WEB: DSN,
    });
    expect(json).not.toContain('<');
    expect(JSON.parse(json ?? '')).toMatchObject({
      dsn: DSN,
      app: 'web',
      requestId: '</script><b>',
    });
  });
});
