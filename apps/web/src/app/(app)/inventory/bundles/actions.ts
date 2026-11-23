'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  BundleDto,
  BundleInput,
  BundleStatusInput,
  BundleUpdate,
} from '@dax/inventory-contract';
import { ApiError } from '@dax/web-data-access/server';
import { failure, invalid } from '../../../../lib/action-errors';
import type { ActionState } from '../../../../lib/action-state';
import { api } from '../../../../lib/server';

const CODES = {
  BUNDLE_EXISTS: 'A bundle with that name already exists.',
  STALE: 'Someone else changed this bundle. Reload.',
};

const BundleSave = z.object({ id: z.uuid().optional(), body: z.unknown() });

export async function saveBundle(
  _prev: ActionState,
  payload: z.input<typeof BundleSave>,
): Promise<ActionState> {
  const raw = BundleSave.safeParse(payload);
  if (!raw.success) return { ok: false, error: 'Nothing to save.' };
  const { id, body } = raw.data;
  let target: string;
  try {
    if (!id) {
      const parsed = BundleInput.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const created = await api.request(
        '/inventory/bundles',
        (d) => BundleDto.parse(d),
        { method: 'POST', json: parsed.data },
      );
      target = created.id;
    } else {
      const parsed = BundleUpdate.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      await api.request(`/inventory/bundles/${id}`, () => undefined, {
        method: 'PATCH',
        json: parsed.data,
      });
      target = id;
    }
  } catch (error) {
    return failure(error, 'Could not save the bundle.', CODES);
  }
  revalidatePath('/inventory/bundles', 'layout');
  if (!id) redirect(`/inventory/bundles/${target}`);
  return { ok: true, message: 'Saved.' };
}

const StatusChange = z.object({ id: z.uuid() }).extend(BundleStatusInput.shape);

export async function setBundleActive(
  _prev: ActionState,
  payload: z.input<typeof StatusChange>,
): Promise<ActionState> {
  const parsed = StatusChange.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...json } = parsed.data;
  try {
    await api.request(`/inventory/bundles/${id}/status`, () => undefined, {
      method: 'POST',
      json,
    });
  } catch (error) {
    return failure(error, 'Could not change the bundle.', CODES);
  }
  revalidatePath('/inventory/bundles', 'layout');
  return {
    ok: true,
    message: json.active ? 'Bundle back in use.' : 'Bundle archived.',
  };
}

/** A saved bundle's parts, for adding it to an MRN. */
export async function loadBundle(id: string): Promise<BundleDto | null> {
  if (!z.uuid().safeParse(id).success) return null;
  try {
    return await api.request(`/inventory/bundles/${id}`, (d) =>
      BundleDto.parse(d),
    );
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}
