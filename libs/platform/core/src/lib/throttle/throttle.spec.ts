import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { DaxThrottlerGuard, rateLimitTracker } from './throttle';

describe('rateLimitTracker', () => {
  it('uses the client address the web app forwarded', () => {
    expect(
      rateLimitTracker({
        headers: { 'x-dax-client-ip': ' 198.51.100.7 ' },
        ip: '10.0.0.5',
      }),
    ).toBe('198.51.100.7');
  });

  it('falls back to the connection address', () => {
    expect(rateLimitTracker({ headers: {}, ip: '10.0.0.5' })).toBe('10.0.0.5');
    expect(
      rateLimitTracker({
        headers: { 'x-dax-client-ip': ['a', 'b'] },
        ip: '::1',
      }),
    ).toBe('::1');
    expect(rateLimitTracker({ headers: { 'x-dax-client-ip': '' } })).toBe(
      'unknown',
    );
  });

  it('caps an overlong forwarded value', () => {
    expect(
      rateLimitTracker({ headers: { 'x-dax-client-ip': 'x'.repeat(500) } }),
    ).toHaveLength(64);
  });
});

describe('DaxThrottlerGuard', () => {
  it('answers 429 in the usual error shape', async () => {
    const guard = new DaxThrottlerGuard(
      { throttlers: [{ ttl: 60_000, limit: 1 }] },
      new ThrottlerStorageService(),
      new Reflector(),
    );
    const error = await (
      guard as unknown as { throwThrottlingException(): Promise<void> }
    )
      .throwThrottlingException()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      code: 'RATE_LIMITED',
      message: expect.any(String),
    });
  });
});
