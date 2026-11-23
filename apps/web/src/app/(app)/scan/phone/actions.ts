'use server';

import {
  CatalogLists,
  ItemDetail,
  ItemInput,
  PhoneScanReply,
  PhoneScanStart,
  PhoneScanSuggestion,
  PhoneScanView,
} from '@dax/inventory-contract';
import { ApiError } from '@dax/web-data-access/server';
import { api } from '../../../../lib/server';

export type PhoneResult<T> =
  { ok: true; data: T } | { ok: false; message: string };

async function run<T>(
  path: string,
  parse: (d: unknown) => T,
  init: { method?: string; json?: unknown } = {},
): Promise<PhoneResult<T>> {
  try {
    return { ok: true, data: await api.request(path, parse, init) };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      // e.g. the reply did not match the expected shape: report, don't crash.
      console.error('Phone scan action failed', path, error);
      return { ok: false, message: 'Something went wrong. Try again.' };
    }
    if (error.status === 401)
      return { ok: false, message: 'Your sign-in ended. Reload the page.' };
    if (error.status === 404)
      return { ok: false, message: 'That phone session is gone.' };
    return {
      ok: false,
      message: error.body.message ?? 'Something went wrong. Try again.',
    };
  }
}

const view = (d: unknown) => PhoneScanView.parse(d);
const base = '/inventory/phone-scans';
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function startPhoneScan() {
  return run(base, (d) => PhoneScanStart.parse(d), { method: 'POST' });
}

export async function getPhoneScan(id: string) {
  if (!isId(id)) return { ok: false as const, message: 'Unknown session.' };
  return run(`${base}/${id}`, view);
}

export async function extendPhoneScan(id: string) {
  if (!isId(id)) return { ok: false as const, message: 'Unknown session.' };
  return run(`${base}/${id}/extend`, view, { method: 'POST' });
}

export async function endPhoneScan(id: string) {
  if (!isId(id)) return { ok: false as const, message: 'Unknown session.' };
  return run(`${base}/${id}/end`, view, { method: 'POST' });
}

export async function scanOnPc(id: string, code: string, format?: string) {
  const trimmed = code.trim();
  if (!isId(id) || !trimmed || trimmed.length > 512)
    return { ok: false as const, message: 'That code could not be read.' };
  return run(`${base}/${id}/scan`, (d) => PhoneScanReply.parse(d), {
    method: 'POST',
    json: {
      code: trimmed,
      ...(format && /^[a-z0-9_]{2,24}$/.test(format) ? { format } : {}),
    },
  });
}

export async function setPhoneScanQty(id: string, lineId: string, qty: string) {
  if (!isId(id) || !isId(lineId))
    return { ok: false as const, message: 'Unknown line.' };
  return run(`${base}/${id}/lines/${lineId}`, view, {
    method: 'PATCH',
    json: { qty },
  });
}

export async function removePhoneScanLine(id: string, lineId: string) {
  if (!isId(id) || !isId(lineId))
    return { ok: false as const, message: 'Unknown line.' };
  return run(`${base}/${id}/lines/${lineId}`, view, { method: 'DELETE' });
}

// ------------------------------------------------------- line details

export async function getLineSuggestion(id: string, lineId: string) {
  if (!isId(id) || !isId(lineId))
    return { ok: false as const, message: 'Unknown line.' };
  return run(`${base}/${id}/lines/${lineId}/suggest`, (d) =>
    PhoneScanSuggestion.parse(d),
  );
}

export async function getLineItem(itemId: string) {
  if (!isId(itemId)) return { ok: false as const, message: 'Unknown item.' };
  return run(`/inventory/items/${itemId}`, (d) => ItemDetail.parse(d));
}

export async function getBrands() {
  return run('/inventory/catalog', (d) =>
    CatalogLists.parse(d).brands.filter((b) => b.active),
  );
}

export async function linkLine(
  id: string,
  lineId: string,
  itemId: string,
  saveBarcode: boolean,
) {
  if (!isId(id) || !isId(lineId) || !isId(itemId))
    return { ok: false as const, message: 'Unknown line.' };
  return run(`${base}/${id}/lines/${lineId}/link`, view, {
    method: 'POST',
    json: { itemId, saveBarcode },
  });
}

export interface NewItemFromLine {
  partNo: string;
  brandId: string;
  description: string;
  uom: string;
  minQty: string;
}

/** Creates the item, then keeps the scanned code on it as a barcode. */
export async function createItemForLine(
  id: string,
  lineId: string,
  input: NewItemFromLine,
) {
  if (!isId(id) || !isId(lineId))
    return { ok: false as const, message: 'Unknown line.' };
  const parsed = ItemInput.safeParse({ ...input, minQty: input.minQty || '0' });
  if (!parsed.success) {
    return {
      ok: false as const,
      message:
        parsed.error.issues[0]?.message ??
        'Check the item details and try again.',
    };
  }
  const created = await run('/inventory/items', (d) => ItemDetail.parse(d), {
    method: 'POST',
    json: parsed.data,
  });
  if (!created.ok) return created;
  return linkLine(id, lineId, created.data.id, true);
}
