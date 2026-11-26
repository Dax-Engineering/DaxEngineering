import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HealthStatus } from '@dax/contracts';
import { NoRateLimit, Public, WORKER_HEARTBEAT_JOB } from '@dax/platform-core';
import { OutboxStatus, PrismaService } from '@dax/platform-db';

export const WORKER_STALE_AFTER_MS = 2 * 60 * 1000;
export const OUTBOX_STALE_AFTER_MS = 15 * 60 * 1000;

export interface StatusFacts {
  database: boolean;
  heartbeatAt: Date | null;
  anyFailedEvents: boolean;
  oldestPendingAt: Date | null;
}

export function statusOf(facts: StatusFacts, now: Date): HealthStatus {
  const age = (at: Date) => now.getTime() - at.getTime();
  const checks = {
    database: facts.database,
    worker:
      facts.heartbeatAt !== null &&
      age(facts.heartbeatAt) < WORKER_STALE_AFTER_MS,
    outbox:
      facts.database &&
      !facts.anyFailedEvents &&
      (facts.oldestPendingAt === null ||
        age(facts.oldestPendingAt) < OUTBOX_STALE_AFTER_MS),
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    status: ok ? 'ok' : 'degraded',
    checks: Object.fromEntries(
      Object.entries(checks).map(([k, up]) => [k, up ? 'up' : 'down']),
    ),
  };
}

@Controller('health')
@Public()
@NoRateLimit()
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get('live')
  @HttpCode(200)
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<HealthStatus> {
    const database = (await this.db.ping()) ? 'up' : 'down';
    if (database === 'down') {
      throw new ServiceUnavailableException({
        status: 'degraded',
        checks: { database },
      });
    }
    return { status: 'ok', checks: { database } };
  }

  @Get('status')
  async status(): Promise<HealthStatus> {
    const result = statusOf(await this.facts(), new Date());
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }

  private async facts(): Promise<StatusFacts> {
    const down: StatusFacts = {
      database: false,
      heartbeatAt: null,
      anyFailedEvents: false,
      oldestPendingAt: null,
    };
    if (!(await this.db.ping())) return down;
    try {
      const [heartbeat, failed, pending] = await Promise.all([
        this.db.jobRun.findUnique({
          where: { name: WORKER_HEARTBEAT_JOB },
          select: { lastRunAt: true },
        }),
        this.db.outboxEvent.findFirst({
          where: { status: OutboxStatus.FAILED },
          select: { id: true },
        }),
        this.db.outboxEvent.findFirst({
          where: { status: OutboxStatus.PENDING },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);
      return {
        database: true,
        heartbeatAt: heartbeat?.lastRunAt ?? null,
        anyFailedEvents: failed !== null,
        oldestPendingAt: pending?.createdAt ?? null,
      };
    } catch {
      return down;
    }
  }
}
