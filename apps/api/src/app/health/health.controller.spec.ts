import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '@dax/platform-db';
import { describe, expect, it } from 'vitest';
import {
  HealthController,
  OUTBOX_STALE_AFTER_MS,
  statusOf,
  WORKER_STALE_AFTER_MS,
} from './health.controller';

const controller = (up: boolean) =>
  new HealthController({ ping: async () => up } as unknown as PrismaService);

describe('HealthController', () => {
  it('is live without touching the database', () => {
    expect(controller(false).live()).toEqual({ status: 'ok' });
  });

  it('is ready only when the database answers', async () => {
    await expect(controller(true).ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
    await expect(controller(false).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('statusOf', () => {
  const now = new Date('2026-11-26T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const healthy = {
    database: true,
    heartbeatAt: ago(10_000),
    anyFailedEvents: false,
    oldestPendingAt: null,
  };

  it('is ok when the database, worker and outbox are all fine', () => {
    expect(statusOf(healthy, now)).toEqual({
      status: 'ok',
      checks: { database: 'up', worker: 'up', outbox: 'up' },
    });
    expect(
      statusOf({ ...healthy, oldestPendingAt: ago(60_000) }, now).status,
    ).toBe('ok');
  });

  it('flags a silent worker', () => {
    expect(statusOf({ ...healthy, heartbeatAt: null }, now).checks).toEqual({
      database: 'up',
      worker: 'down',
      outbox: 'up',
    });
    expect(
      statusOf({ ...healthy, heartbeatAt: ago(WORKER_STALE_AFTER_MS) }, now)
        .status,
    ).toBe('degraded');
  });

  it('flags dead or stuck events', () => {
    expect(
      statusOf({ ...healthy, anyFailedEvents: true }, now).checks?.['outbox'],
    ).toBe('down');
    expect(
      statusOf({ ...healthy, oldestPendingAt: ago(OUTBOX_STALE_AFTER_MS) }, now)
        .checks?.['outbox'],
    ).toBe('down');
  });

  it('reports everything down without a database', () => {
    expect(
      statusOf(
        {
          database: false,
          heartbeatAt: null,
          anyFailedEvents: false,
          oldestPendingAt: null,
        },
        now,
      ),
    ).toEqual({
      status: 'degraded',
      checks: { database: 'down', worker: 'down', outbox: 'down' },
    });
  });

  it('answers 503 from the endpoint when degraded', async () => {
    await expect(controller(false).status()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
