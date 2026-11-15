import { cookies } from 'next/headers';
import {
  apiUrl,
  forwardHeaders,
  isSameOrigin,
  readServerConfig,
} from '@dax/web-data-access/server';
import { PHONE_COOKIE } from '../../../lib/phone';
import { APP } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, ok = false): Response {
  return Response.json(
    { ok },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * A label photo from a paired phone, for one line of its scan list. The
 * phone's scan token comes from its cookie; the photo is stored for the PC
 * user, like any other upload.
 */
export async function POST(request: Request): Promise<Response> {
  const config = readServerConfig(APP);
  if (!isSameOrigin(request, config.trustedOrigins)) return reply(403);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return reply(413);
  }
  const token = (await cookies()).get(PHONE_COOKIE)?.value;
  if (!token) return reply(401);
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const lineId = form?.get('lineId');
  if (
    !(file instanceof File) ||
    typeof lineId !== 'string' ||
    !UUID.test(lineId)
  ) {
    return reply(400);
  }
  if (file.size === 0 || file.size > MAX_BYTES) return reply(413);

  const body = new FormData();
  body.set('phoneToken', token);
  body.set('lineId', lineId);
  body.set('file', file, file.name || 'label.jpg');
  const upstream = await fetch(
    apiUrl('/inventory/phone-scans/photo', config.apiUrl),
    {
      method: 'POST',
      headers: forwardHeaders(APP, config, request.headers),
      body,
      cache: 'no-store',
    },
  ).catch(() => null);
  if (!upstream) return reply(503);
  const data = (await upstream.json().catch(() => null)) as {
    ok?: boolean;
  } | null;
  return reply(
    upstream.ok ? 200 : upstream.status,
    upstream.ok && data?.ok === true,
  );
}
