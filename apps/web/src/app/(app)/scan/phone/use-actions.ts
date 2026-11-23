'use server';

import {
  CountDto,
  GrnDto,
  MRN_SUBTYPES,
  MrnDto,
  PhoneScanView,
} from '@dax/inventory-contract';
import { ApiError } from '@dax/web-data-access/server';
import { api } from '../../../../lib/server';
import { grnPath } from '../../inventory/receiving/_lib/labels';
import { mrnPath } from '../../inventory/issuing/_lib/labels';
import { countPath } from '../../inventory/counts/_lib/labels';

// Turning the scanned list into a document. Each action reads the list from
// the server again, so it uses exactly what is saved, and only known parts.

export type UseResult =
  { ok: true; path: string } | { ok: false; message: string };

const UUID = /^[0-9a-f-]{36}$/i;

function failed(error: unknown, what: string): UseResult {
  if (error instanceof ApiError) {
    return { ok: false, message: error.body.message ?? `Could not ${what}.` };
  }
  console.error('Using the phone scan list failed', what, error);
  return { ok: false, message: `Could not ${what}. Try again.` };
}

/** Known parts on the list; only the chosen lines when `lineIds` is given. */
async function knownLines(sessionId: string, lineIds?: string[]) {
  if (!UUID.test(sessionId)) throw new Error('Unknown session');
  const view = await api.request(`/inventory/phone-scans/${sessionId}`, (d) =>
    PhoneScanView.parse(d),
  );
  const only = lineIds?.length ? new Set(lineIds) : null;
  return view.lines.flatMap((l) =>
    l.item && (!only || only.has(l.id))
      ? [{ itemId: l.item.id, qty: l.qty }]
      : [],
  );
}

/** A draft GRN from the supplier, with every known part and its quantity. */
export async function receiveList(
  sessionId: string,
  supplierId: string,
  lineIds?: string[],
): Promise<UseResult> {
  if (!UUID.test(supplierId))
    return { ok: false, message: 'Choose a supplier.' };
  try {
    const lines = await knownLines(sessionId, lineIds);
    if (!lines.length) return { ok: false, message: 'No known parts chosen.' };
    const grn = await api.request('/inventory/grns', (d) => GrnDto.parse(d), {
      method: 'POST',
      json: { supplierId, deliveryNote: 'Scanned with a phone' },
    });
    await api.request(`/inventory/grns/${grn.id}`, (d) => GrnDto.parse(d), {
      method: 'PATCH',
      json: {
        version: grn.version,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          qtyExpected: null,
          qtyGood: l.qty,
          qtyDamaged: '0',
          wrongItem: false,
        })),
      },
    });
    return { ok: true, path: grnPath(grn.id) };
  } catch (error) {
    return failed(error, 'make the GRN');
  }
}

export interface RequestInput {
  subtype: string;
  departmentId: string;
  customerId: string | null;
  jobNumber: string;
}

/** A draft material request with every known part and its quantity. */
export async function requestList(
  sessionId: string,
  input: RequestInput,
  lineIds?: string[],
): Promise<UseResult> {
  if (!(MRN_SUBTYPES as readonly string[]).includes(input.subtype))
    return { ok: false, message: 'Choose the MRN type.' };
  if (!UUID.test(input.departmentId))
    return { ok: false, message: 'Choose a department.' };
  if (input.customerId && !UUID.test(input.customerId))
    return { ok: false, message: 'Choose the customer again.' };
  try {
    const lines = await knownLines(sessionId, lineIds);
    if (!lines.length) return { ok: false, message: 'No known parts chosen.' };
    const mrn = await api.request('/inventory/mrns', (d) => MrnDto.parse(d), {
      method: 'POST',
      json: {
        subtype: input.subtype,
        departmentId: input.departmentId,
        customerId: input.customerId,
        jobNumber: input.jobNumber.trim() || null,
        notes: 'Scanned with a phone',
        lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      },
    });
    return { ok: true, path: mrnPath(mrn.id) };
  } catch (error) {
    return failed(error, 'raise the MRN');
  }
}

/**
 * A cycle count of one bin, with the scanned quantities entered. Parts the
 * bin holds that were not scanned stay uncounted for you to fill in.
 */
export async function countList(
  sessionId: string,
  binId: string,
  lineIds?: string[],
): Promise<UseResult> {
  if (!UUID.test(binId)) return { ok: false, message: 'Choose a bin.' };
  try {
    const lines = await knownLines(sessionId, lineIds);
    if (!lines.length) return { ok: false, message: 'No known parts chosen.' };
    let count = await api.request(
      '/inventory/counts',
      (d) => CountDto.parse(d),
      {
        method: 'POST',
        json: { kind: 'CYCLE', blind: false, zoneIds: [], binIds: [binId] },
      },
    );
    const onSheet = new Map(
      count.bins.flatMap((b) => b.lines.map((l) => [l.item.id, l.id] as const)),
    );
    const entries = lines.flatMap((l) => {
      const lineId = onSheet.get(l.itemId);
      return lineId ? [{ lineId, countedQty: l.qty }] : [];
    });
    if (entries.length) {
      count = await api.request(
        `/inventory/counts/${count.id}/counts`,
        (d) => CountDto.parse(d),
        { method: 'POST', json: { version: count.version, lines: entries } },
      );
    }
    for (const l of lines.filter((x) => !onSheet.has(x.itemId))) {
      count = await api.request(
        `/inventory/counts/${count.id}/lines`,
        (d) => CountDto.parse(d),
        {
          method: 'POST',
          json: {
            version: count.version,
            binId,
            itemId: l.itemId,
            countedQty: l.qty,
          },
        },
      );
    }
    return { ok: true, path: countPath(count.id) };
  } catch (error) {
    return failed(error, 'start the count');
  }
}
