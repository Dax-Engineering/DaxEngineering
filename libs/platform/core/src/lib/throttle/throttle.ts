import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  SkipThrottle,
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 1000;
const MAX_TRACKER_LENGTH = 64;

/** Overrides the default per-client limit for a route or controller. */
export const RateLimit = (perMinute: number) =>
  Throttle({ default: { limit: perMinute, ttl: RATE_LIMIT_WINDOW_MS } });

export const NoRateLimit = () => SkipThrottle();

interface TrackedRequest {
  headers?: Record<string, unknown>;
  ip?: unknown;
}

/** The web apps pass the browser's address in x-dax-client-ip; only they hold an internal token. */
export function rateLimitTracker(req: TrackedRequest): string {
  const forwarded = req.headers?.['x-dax-client-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.trim().slice(0, MAX_TRACKER_LENGTH);
  }
  return typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
}

@Injectable()
export class DaxThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: TrackedRequest): Promise<string> {
    return Promise.resolve(rateLimitTracker(req));
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Wait a minute and try again.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function rateLimitModule() {
  return ThrottlerModule.forRoot({
    throttlers: [
      {
        name: 'default',
        ttl: RATE_LIMIT_WINDOW_MS,
        limit: DEFAULT_RATE_LIMIT_PER_MINUTE,
      },
    ],
  });
}
