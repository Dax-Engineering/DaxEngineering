import { SerialLabelRequest } from '@dax/inventory-contract';
import {
  contentDisposition,
  isSameOrigin,
  plainText,
  readServerConfig,
  relayFile,
} from '@dax/web-data-access/server';
import { APP, api } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const MAX_FORM_BYTES = 128 * 1024;

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export async function POST(request: Request): Promise<Response> {
  const config = readServerConfig(APP);
  if (!isSameOrigin(request, config.trustedOrigins)) {
    return plainText(403, 'This request was blocked.');
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_FORM_BYTES) {
    return plainText(413, 'Too many labels in one go.');
  }
  const form = await request.formData().catch(() => null);
  if (!form) return plainText(400, 'The label request could not be read.');

  const ids = (key: string) => {
    const all = form
      .getAll(key)
      .filter((v): v is string => typeof v === 'string');
    return all.length ? all : undefined;
  };
  const skip = text(form, 'skip');
  const parsed = SerialLabelRequest.safeParse({
    serialIds: ids('serialIds'),
    grnId: text(form, 'grnId'),
    grnLineId: text(form, 'grnLineId'),
    itemId: text(form, 'itemId'),
    binIds: ids('binIds'),
    zoneId: text(form, 'zoneId'),
    unprinted: form.get('unprinted') === 'true',
    skip: skip === undefined ? undefined : Number(skip),
  });
  if (!parsed.success) {
    return plainText(
      400,
      'Choose which serial labels to print, then try again.',
    );
  }

  const upstream = await api.call('/inventory/labels/serials', {
    method: 'POST',
    json: parsed.data,
    accept: 'application/pdf',
  });
  if (upstream.status === 401) {
    await upstream.body?.cancel();
    return new Response(null, {
      status: 303,
      headers: { location: '/login', 'cache-control': 'private, no-store' },
    });
  }
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as {
      message?: string;
    } | null;
    return plainText(
      upstream.status === 403 ? 403 : upstream.status === 409 ? 409 : 502,
      upstream.status === 403
        ? "You don't have permission to print these labels."
        : upstream.status === 409 && body?.message
          ? body.message
          : 'The labels could not be made. Close this tab and try again.',
    );
  }
  return relayFile(upstream, {
    contentType: 'application/pdf',
    disposition: contentDisposition('inline', 'serial-labels.pdf'),
  });
}
