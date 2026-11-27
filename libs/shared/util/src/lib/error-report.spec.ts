import { describe, expect, it } from 'vitest';
import {
  PRIVATE_DATA_COLLECTION,
  scrubEvent,
  withoutQuery,
} from './error-report';

describe('scrubEvent', () => {
  const event = {
    message: 'boom',
    request: {
      method: 'POST',
      url: 'https://stores.example.test/api/x?token=secret#frag',
      headers: {
        Cookie: 'dax-web.session_token=abc',
        'X-Request-Id': 'req-12345678',
        authorization: 'Bearer secret',
      },
      cookies: { session: 'abc' },
      data: '{"password":"hunter2"}',
      query_string: 'token=secret',
      env: { REMOTE_ADDR: '203.0.113.9' },
    },
    user: {
      id: 'u-1',
      email: 'someone@example.test',
      username: 'someone',
      name: 'Some One',
      ip_address: '203.0.113.9',
    },
    tags: { service: 'api' } as Record<string, unknown>,
    breadcrumbs: [
      {
        category: 'fetch',
        type: 'http',
        timestamp: 1,
        data: {
          method: 'GET',
          url: '/api/files/1?sig=abc',
          status_code: 500,
          body: 'x',
        },
      },
      { category: 'console', level: 'log', message: 'user typed hunter2' },
    ],
  };

  it('keeps only method, path, user id and the request id', () => {
    const out = scrubEvent(event);
    expect(out.request).toEqual({
      method: 'POST',
      url: 'https://stores.example.test/api/x',
    });
    expect(out.user).toEqual({ id: 'u-1' });
    expect(out.tags).toEqual({ service: 'api', request_id: 'req-12345678' });
    expect(out.message).toBe('boom');
  });

  it('drops breadcrumb bodies, query strings and console text', () => {
    const [http, log] = scrubEvent(event).breadcrumbs ?? [];
    expect(http?.data).toEqual({
      method: 'GET',
      url: '/api/files/1',
      status_code: 500,
    });
    expect(log?.message).toBeUndefined();
  });

  it('prefers an explicit request id and ignores malformed ones', () => {
    expect(scrubEvent(event, 'explicit-id-1').tags?.['request_id']).toBe(
      'explicit-id-1',
    );
    expect(
      scrubEvent({ tags: {} as Record<string, unknown> }, 'bad id <script>')
        .tags,
    ).toEqual({});
  });

  it('does not change the original event', () => {
    scrubEvent(event);
    expect(event.request.headers.Cookie).toBe('dax-web.session_token=abc');
    expect(event.user.email).toBe('someone@example.test');
  });

  it('cuts query strings and fragments', () => {
    expect(withoutQuery('/a?b=1')).toBe('/a');
    expect(withoutQuery('/a#b')).toBe('/a');
    expect(withoutQuery('/a')).toBe('/a');
  });
});

describe('PRIVATE_DATA_COLLECTION', () => {
  it('turns every personal or payload source off', () => {
    const values = JSON.stringify(PRIVATE_DATA_COLLECTION);
    expect(values).not.toContain('true');
    expect(PRIVATE_DATA_COLLECTION.httpBodies).toEqual([]);
  });
});
