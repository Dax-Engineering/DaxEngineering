import type { BelowMinRow } from '@dax/inventory-contract';
import type { MailMessage } from '@dax/platform-core';

export const REPORT_PATH = '/inventory/reports/below-minimum';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function textLine(row: BelowMinRow): string {
  return `- ${row.item.partNo} (${row.item.brand}) ${row.item.description}: free ${row.free} of minimum ${row.minQty} ${row.item.uom}, short ${row.shortBy}`;
}

function htmlTable(rows: readonly BelowMinRow[], webOrigin: string): string {
  const cell = 'style="padding:4px 8px;border-bottom:1px solid #ddd"';
  const num =
    'style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right"';
  const body = rows
    .map(
      (r) => `<tr>
<td ${cell}><a href="${escapeHtml(`${webOrigin}/inventory/items/${r.item.id}`)}">${escapeHtml(r.item.partNo)}</a></td>
<td ${cell}>${escapeHtml(r.item.brand)}</td>
<td ${cell}>${escapeHtml(r.item.description)}</td>
<td ${num}>${escapeHtml(r.free)}</td>
<td ${num}>${escapeHtml(r.minQty)}</td>
<td ${num}><b>${escapeHtml(r.shortBy)}</b></td>
<td ${num}>${escapeHtml(r.waiting)}</td>
</tr>`,
    )
    .join('\n');
  return `<table style="border-collapse:collapse;font-size:14px">
<thead><tr>
<th ${cell} align="left">Part number</th><th ${cell} align="left">Brand</th><th ${cell} align="left">Description</th>
<th ${num}>Free</th><th ${num}>Minimum</th><th ${num}>Short by</th><th ${num}>Waiting on MRNs</th>
</tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

/** Sent as soon as parts drop below minimum, when instant emails are on. */
export function lowStockAlertEmail(
  to: { email: string; name: string },
  rows: readonly BelowMinRow[],
  webOrigin: string,
): MailMessage {
  const subject =
    rows.length === 1
      ? `${rows[0].item.partNo} is below minimum`
      : `${plural(rows.length, 'part', 'parts')} went below minimum`;
  const link = `${webOrigin}${REPORT_PATH}`;
  const text = [
    `Hello ${to.name},`,
    '',
    'Free stock has dropped under the minimum for:',
    ...rows.map(textLine),
    '',
    `See the full reorder list: ${link}`,
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(to.name)},</p>
<p>Free stock has dropped under the minimum for:</p>
${htmlTable(rows, webOrigin)}
<p><a href="${escapeHtml(link)}">See the full reorder list</a></p>`;
  return { to: to.email, subject, text, html };
}

/** The weekly list of every part under its minimum. */
export function lowStockReportEmail(
  to: { email: string; name: string },
  report: { items: readonly BelowMinRow[]; truncated: boolean },
  webOrigin: string,
): MailMessage {
  const count = `${report.items.length}${report.truncated ? '+' : ''}`;
  const subject = `Weekly low-stock report: ${count} ${report.items.length === 1 && !report.truncated ? 'part' : 'parts'} below minimum`;
  const link = `${webOrigin}${REPORT_PATH}`;
  const more = report.truncated
    ? 'Only the parts most short are listed. Open the report for the rest.'
    : '';
  const text = [
    `Hello ${to.name},`,
    '',
    'These parts have less free stock than their minimum, most short first:',
    ...report.items.map(textLine),
    '',
    ...(more ? [more] : []),
    `Open the report: ${link}`,
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(to.name)},</p>
<p>These parts have less free stock than their minimum, most short first:</p>
${htmlTable(report.items, webOrigin)}
${more ? `<p>${more}</p>` : ''}
<p><a href="${escapeHtml(link)}">Open the report</a></p>`;
  return { to: to.email, subject, text, html };
}
