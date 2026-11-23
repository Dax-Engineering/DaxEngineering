'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  AodCreate,
  AodDto,
  AodReject,
  AodSign,
  AodUpdate,
  BinDetail,
  HoldConvert,
  HoldInput,
  HoldRelease,
  MrnAllocate,
  MrnDto,
  MrnInput,
  MrnShortClose,
  MrnUpdate,
  ScanResult,
} from '@dax/inventory-contract';
import { CustomerPage } from '@dax/parties-contract';
import { ApiError } from '@dax/web-data-access/server';
import { failure, invalid } from '../../../../../lib/action-errors';
import type { ActionState } from '../../../../../lib/action-state';
import { toQuery } from '../../../../../lib/query';
import { ScanCode, scanLookupPath } from '../../../../../lib/scan-code';
import { api } from '../../../../../lib/server';
import type { PickerOption } from '../../_lib/search-actions';
import { aodPath, holdPath, mrnPath } from './labels';
import type { CodeMatch } from './types';

const CODES: Record<string, string> = {
  STALE: 'Someone else changed this. Reload.',
  OUT_OF_SCOPE: 'This AOD is for a department you do not approve for.',
  NOT_ISSUED: 'Approve and issue the AOD before printing it.',
  INVALID_STATE:
    'This has moved on since you opened it. Reload to see where it is now.',
  NOT_ENOUGH_FREE_STOCK:
    'There is not enough free stock for that any more. Reload to see what is free now.',
  NOT_RESERVED:
    'More is being picked than is reserved for this MRN. Lower the quantity.',
  INSUFFICIENT_STOCK:
    'A bin does not hold that much of the part. Pick from another bin or lower the quantity.',
  NUMBER_SERIES_UNAVAILABLE:
    'No number series is open for this year. Ask an administrator to set it up, then try again.',
};

function refresh() {
  revalidatePath('/inventory', 'layout');
  revalidatePath('/');
}

async function quietly<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError) return fallback;
    throw error;
  }
}

const Search = z.string().trim().max(100);

export async function searchCustomers(q: string): Promise<PickerOption[]> {
  const query = Search.safeParse(q);
  if (!query.success) return [];
  const page = await quietly(
    api.request(
      `/parties/customers${toQuery({ q: query.data || undefined, active: 'true', limit: 20 })}`,
      (d) => CustomerPage.parse(d),
    ),
    { items: [], total: 0, page: 1, limit: 20 },
  );
  return page.items.map((c) => ({ value: c.id, label: c.name }));
}

async function versionAfter(
  path: string,
  init: { method: string; json: unknown },
  parse: (d: unknown) => { version: number },
): Promise<number> {
  const saved = await api.request(
    path,
    (d) => {
      try {
        return parse(d).version;
      } catch {
        return null;
      }
    },
    init,
  );
  if (saved !== null) return saved;
  return api.request(path, (d) => parse(d).version);
}

const MrnSave = z.object({
  id: z.uuid().optional(),
  body: z.unknown(),
  submit: z.boolean().default(false),
});

export async function saveMrn(
  _prev: ActionState,
  payload: z.input<typeof MrnSave>,
): Promise<ActionState> {
  const raw = MrnSave.safeParse(payload);
  if (!raw.success) return { ok: false, error: 'Nothing to save.' };
  const { id, body, submit } = raw.data;
  let target: string;
  try {
    if (!id) {
      const parsed = MrnInput.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const created = await api.request(
        '/inventory/mrns',
        (d) => MrnDto.parse(d),
        { method: 'POST', json: parsed.data },
      );
      target = created.id;
      if (submit)
        await api.request(`/inventory/mrns/${created.id}/submit`, () => null, {
          method: 'POST',
          json: { version: created.version },
        });
    } else {
      const parsed = MrnUpdate.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const version = await versionAfter(
        `/inventory/mrns/${id}`,
        { method: 'PATCH', json: parsed.data },
        (d) => MrnDto.parse(d),
      );
      target = id;
      if (submit)
        await api.request(`/inventory/mrns/${id}/submit`, () => null, {
          method: 'POST',
          json: { version },
        });
    }
  } catch (error) {
    refresh();
    return failure(error, 'Could not save the MRN.', CODES);
  }
  refresh();
  if (!id) redirect(mrnPath(target));
  return { ok: true, message: submit ? 'Submitted for checking.' : 'Saved.' };
}

const MrnStep = z.object({
  id: z.uuid(),
  version: z.int(),
  step: z.enum(['submit', 'check', 'cancel']),
});

const MRN_DONE = {
  submit: 'Submitted for checking.',
  check: 'Checked. Free stock is reserved; anything short is waiting.',
  cancel: 'MRN cancelled. Its reservations are released.',
} as const;

export async function mrnStep(
  _prev: ActionState,
  payload: z.input<typeof MrnStep>,
): Promise<ActionState> {
  const parsed = MrnStep.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Unknown MRN.' };
  const { id, version, step } = parsed.data;
  try {
    await api.request(`/inventory/mrns/${id}/${step}`, () => null, {
      method: 'POST',
      json: { version },
    });
  } catch (error) {
    return failure(error, 'Could not update the MRN.', CODES);
  }
  refresh();
  return { ok: true, message: MRN_DONE[step] };
}

const ShortClosePayload = MrnShortClose.extend({ id: z.uuid() });

export async function shortCloseMrn(
  _prev: ActionState,
  payload: z.input<typeof ShortClosePayload>,
): Promise<ActionState> {
  const parsed = ShortClosePayload.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...body } = parsed.data;
  try {
    await api.request(`/inventory/mrns/${id}/short-close`, () => null, {
      method: 'POST',
      json: body,
    });
  } catch (error) {
    return failure(error, 'Could not short-close the MRN.', CODES);
  }
  refresh();
  return { ok: true, message: 'Short-closed. Waiting quantities are dropped.' };
}

const AllocatePayload = MrnAllocate.extend({ id: z.uuid() });

export async function allocateMrn(
  _prev: ActionState,
  payload: z.input<typeof AllocatePayload>,
): Promise<ActionState> {
  const parsed = AllocatePayload.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...body } = parsed.data;
  try {
    await api.request(`/inventory/mrns/${id}/allocate`, () => null, {
      method: 'POST',
      json: body,
    });
  } catch (error) {
    return failure(error, 'Could not assign the stock.', CODES);
  }
  refresh();
  return { ok: true, message: 'Stock assigned to this MRN.' };
}

export async function startPicking(
  _prev: ActionState,
  payload: z.input<typeof AodCreate>,
): Promise<ActionState> {
  const parsed = AodCreate.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  let created: AodDto;
  try {
    created = await api.request('/inventory/aods', (d) => AodDto.parse(d), {
      method: 'POST',
      json: parsed.data,
    });
  } catch (error) {
    return failure(error, 'Could not start picking.', CODES);
  }
  refresh();
  redirect(aodPath(created.id));
}

const AodCommand = z.object({
  id: z.uuid(),
  version: z.int(),
  step: z.enum(['save', 'submit', 'withdraw', 'approve', 'issue', 'cancel']),
  update: z.unknown().optional(),
});

const AOD_DONE = {
  save: 'Saved.',
  submit: 'Sent for approval. Issue it once a department head approves it.',
  withdraw: 'Taken back. Change it and send it for approval again.',
  approve: 'Approved. Stores can now issue and print it.',
  issue: 'Issued. Print the AOD and upload the signed copy.',
  cancel: 'AOD cancelled. The stock stays reserved for the MRN.',
} as const;

const AOD_FAILED = {
  save: 'Could not save the AOD.',
  submit: 'Could not send the AOD for approval.',
  withdraw: 'Could not take the AOD back.',
  approve: 'Could not approve the AOD.',
  issue: 'Could not issue the AOD.',
  cancel: 'Could not cancel the AOD.',
} as const;

const RejectPayload = AodReject.extend({ id: z.uuid() });

export async function rejectAod(
  _prev: ActionState,
  payload: z.input<typeof RejectPayload>,
): Promise<ActionState> {
  const parsed = RejectPayload.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...body } = parsed.data;
  try {
    await api.request(`/inventory/aods/${id}/reject`, () => null, {
      method: 'POST',
      json: body,
    });
  } catch (error) {
    refresh();
    return failure(error, 'Could not reject the AOD.', CODES);
  }
  refresh();
  return { ok: true, message: 'Rejected. It is back with Stores.' };
}

export async function aodStep(
  _prev: ActionState,
  payload: z.input<typeof AodCommand>,
): Promise<ActionState> {
  const parsed = AodCommand.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Unknown AOD.' };
  const { id, step } = parsed.data;
  let version = parsed.data.version;
  let update: AodUpdate | undefined;
  if (parsed.data.update !== undefined) {
    const body = AodUpdate.safeParse(
      Object.assign({}, parsed.data.update, { version }),
    );
    if (!body.success) return invalid(body.error);
    update = body.data;
  }
  try {
    if (update)
      version = await versionAfter(
        `/inventory/aods/${id}`,
        { method: 'PATCH', json: update },
        (d) => AodDto.parse(d),
      );
    if (step !== 'save')
      await api.request(`/inventory/aods/${id}/${step}`, () => null, {
        method: 'POST',
        json: { version },
      });
  } catch (error) {
    refresh();
    return failure(error, AOD_FAILED[step], CODES);
  }
  refresh();
  return { ok: true, message: AOD_DONE[step] };
}

const SignPayload = AodSign.extend({ id: z.uuid() });

export async function signAod(
  _prev: ActionState,
  payload: z.input<typeof SignPayload>,
): Promise<ActionState> {
  const parsed = SignPayload.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Upload the signed copy.' };
  const { id, ...body } = parsed.data;
  try {
    await api.request(`/inventory/aods/${id}/sign`, () => null, {
      method: 'POST',
      json: body,
    });
  } catch (error) {
    return failure(error, 'Could not record the signed copy.', CODES);
  }
  refresh();
  return { ok: true, message: 'Signed copy saved. The AOD is complete.' };
}

export async function identifyCode(raw: string): Promise<CodeMatch> {
  const code = ScanCode.safeParse(raw);
  if (!code.success) return { type: 'none' };
  let result: ScanResult;
  try {
    result = await api.request(scanLookupPath(code.data), (d) =>
      ScanResult.parse(d),
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) redirect('/login');
    if (error.status === 404) return { type: 'none' };
    return { type: 'error', message: 'The lookup failed. Try again.' };
  }
  if (result.type === 'item') return { type: 'part', itemIds: [result.id] };
  if (result.type === 'choices')
    return { type: 'part', itemIds: result.items.map((i) => i.id) };
  if (result.type !== 'bin') return { type: 'none' };
  const bin = await quietly(
    api.request(`/inventory/bins/${result.id}`, (d) => BinDetail.parse(d)),
    null,
  );
  return bin
    ? { type: 'bin', bin: { id: bin.id, code: bin.code } }
    : { type: 'none' };
}

const HoldCreated = z.object({ id: z.uuid() });

export async function createHold(
  _prev: ActionState,
  payload: z.input<typeof HoldInput>,
): Promise<ActionState> {
  const parsed = HoldInput.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  let id: string;
  try {
    ({ id } = await api.request(
      '/inventory/holds',
      (d) => HoldCreated.parse(d),
      { method: 'POST', json: parsed.data },
    ));
  } catch (error) {
    return failure(error, 'Could not place the hold.', CODES);
  }
  refresh();
  redirect(holdPath(id));
}

const ReleasePayload = HoldRelease.extend({ id: z.uuid() });

export async function releaseHold(
  _prev: ActionState,
  payload: z.input<typeof ReleasePayload>,
): Promise<ActionState> {
  const parsed = ReleasePayload.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...body } = parsed.data;
  try {
    await api.request(`/inventory/holds/${id}/release`, () => null, {
      method: 'POST',
      json: body,
    });
  } catch (error) {
    return failure(error, 'Could not release the hold.', CODES);
  }
  refresh();
  return { ok: true, message: 'Released. The stock is free again.' };
}

const ConvertPayload = HoldConvert.extend({ id: z.uuid() });

export async function convertHold(
  _prev: ActionState,
  payload: z.input<typeof ConvertPayload>,
): Promise<ActionState> {
  const parsed = ConvertPayload.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...body } = parsed.data;
  let mrnId: string;
  try {
    ({ id: mrnId } = await api.request(
      `/inventory/holds/${id}/convert`,
      (d) => MrnDto.parse(d),
      { method: 'POST', json: body },
    ));
  } catch (error) {
    return failure(error, 'Could not turn the hold into an MRN.', CODES);
  }
  refresh();
  redirect(mrnPath(mrnId));
}
