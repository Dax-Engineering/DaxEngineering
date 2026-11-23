'use server';

import { revalidatePath } from 'next/cache';
import {
  LowStockSettingsDto,
  LowStockSettingsInput,
} from '@dax/inventory-contract';
import { failure, invalid } from '../../../../../lib/action-errors';
import type { ActionState } from '../../../../../lib/action-state';
import { api } from '../../../../../lib/server';

export async function saveLowStockSettings(
  _prev: ActionState,
  payload: unknown,
): Promise<ActionState> {
  const parsed = LowStockSettingsInput.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request(
      '/inventory/low-stock/settings',
      (d) => LowStockSettingsDto.parse(d),
      { method: 'PUT', json: parsed.data },
    );
  } catch (error) {
    return failure(error, 'Could not save the email settings.');
  }
  revalidatePath('/inventory/reports/low-stock-emails');
  return { ok: true, message: 'Saved.' };
}
