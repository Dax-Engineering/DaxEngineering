'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure } from '../../../lib/action-errors';
import type { ActionState } from '../../../lib/action-state';
import { api, safePath } from '../../../lib/server';

const Id = z.uuid();

function refresh() {
  revalidatePath('/inbox');
  revalidatePath('/', 'layout');
}

export async function openMessage(id: string, link: string | null) {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return;
  try {
    await api.request(`/me/inbox/${parsed.data}/read`, () => null, {
      method: 'POST',
    });
  } catch {
    // Opening the linked page matters more than the read mark.
  }
  refresh();
  redirect(safePath(link) ?? '/inbox');
}

export async function markDone(
  _prev: ActionState,
  id: string,
): Promise<ActionState> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Reload and try again.' };
  try {
    await api.request(`/me/inbox/${parsed.data}/done`, () => null, {
      method: 'POST',
    });
  } catch (error) {
    return failure(error, 'Could not mark this as done.');
  }
  refresh();
  return { ok: true };
}
