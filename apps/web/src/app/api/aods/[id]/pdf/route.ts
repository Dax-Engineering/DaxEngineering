import {
  contentDisposition,
  plainText,
  relayFile,
} from '@dax/web-data-access/server';
import { isUuid } from '../../../../../lib/load';
import { api } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return plainText(403, 'This request was blocked.');
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainText(404, 'AOD not found.');
  const customer = new URL(request.url).searchParams.get('copy') === 'customer';

  const upstream = await api.call(
    `/inventory/aods/${id}/pdf${customer ? '?copy=customer' : ''}`,
    {
      accept: 'application/pdf',
    },
  );
  if (upstream.status === 401) {
    await upstream.body?.cancel();
    return new Response(null, {
      status: 303,
      headers: { location: '/login', 'cache-control': 'private, no-store' },
    });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const status = [403, 404, 409].includes(upstream.status)
      ? upstream.status
      : 502;
    return plainText(
      status,
      status === 403
        ? "You don't have permission to print this AOD."
        : status === 404
          ? 'AOD not found.'
          : status === 409
            ? 'This AOD cannot be printed in that form yet. Close this tab and check the AOD.'
            : 'The AOD could not be made. Close this tab and try again.',
    );
  }
  return relayFile(upstream, {
    contentType: 'application/pdf',
    disposition: contentDisposition(
      'inline',
      `aod-${id}${customer ? '-customer' : ''}.pdf`,
    ),
  });
}
