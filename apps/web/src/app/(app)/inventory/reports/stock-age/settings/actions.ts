'use server';

import { revalidatePath } from 'next/cache';
import {
  StockAgeSettingsDto,
  StockAgeSettingsInput,
} from '@dax/inventory-contract';
import { failure, invalid } from '../../../../../../lib/action-errors';
import type { ActionState } from '../../../../../../lib/action-state';
import { api } from '../../../../../../lib/server';

export async function saveStockAgeBands(
  _prev: ActionState,
  payload: unknown,
): Promise<ActionState> {
  const parsed = StockAgeSettingsInput.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request(
      '/inventory/reports/stock-age/settings',
      (d) => StockAgeSettingsDto.parse(d),
      { method: 'PUT', json: parsed.data },
    );
  } catch (error) {
    return failure(error, 'Could not save the bands.', {
      STALE: 'Someone else changed the bands. Reload.',
    });
  }
  revalidatePath('/inventory/reports/stock-age', 'layout');
  revalidatePath('/');
  return { ok: true, message: 'Saved.' };
}
