'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  BrandInput,
  MachineModelInput,
  MachineTypeInput,
} from '@dax/inventory-contract';
import { failure, invalid } from '../../../../lib/action-errors';
import type { ActionState } from '../../../../lib/action-state';
import { nullable, text } from '../../../../lib/form-data';
import { api } from '../../../../lib/server';

const CODES = {
  BRAND_EXISTS: 'A brand with this name already exists.',
  MODEL_EXISTS: 'This machine model already exists.',
  TYPE_EXISTS: 'This machine type already exists.',
};

function saved(message: string): ActionState {
  revalidatePath('/inventory/catalog');
  return { ok: true, message };
}

export async function createBrand(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = BrandInput.safeParse({ name: text(form, 'name') });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request('/inventory/brands', () => undefined, {
      method: 'POST',
      json: parsed.data,
    });
  } catch (error) {
    return failure(error, 'Could not add the brand.', CODES);
  }
  return saved(`Brand ${parsed.data.name} added.`);
}

const BrandUpdate = z.object({ id: z.uuid(), input: BrandInput });

export async function updateBrand(
  _prev: ActionState,
  payload: z.input<typeof BrandUpdate>,
): Promise<ActionState> {
  const parsed = BrandUpdate.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request(`/inventory/brands/${parsed.data.id}`, () => undefined, {
      method: 'PATCH',
      json: parsed.data.input,
    });
  } catch (error) {
    return failure(error, 'Could not save the brand.', CODES);
  }
  return saved('Saved.');
}

export async function createMachineType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = MachineTypeInput.safeParse({ name: text(form, 'name') });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request('/inventory/machine-types', () => undefined, {
      method: 'POST',
      json: parsed.data,
    });
  } catch (error) {
    return failure(error, 'Could not add the machine type.', CODES);
  }
  return saved(`Machine type ${parsed.data.name} added.`);
}

const TypeUpdate = z.object({ id: z.uuid(), input: MachineTypeInput });

export async function updateMachineType(
  _prev: ActionState,
  payload: z.input<typeof TypeUpdate>,
): Promise<ActionState> {
  const parsed = TypeUpdate.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request(
      `/inventory/machine-types/${parsed.data.id}`,
      () => undefined,
      { method: 'PATCH', json: parsed.data.input },
    );
  } catch (error) {
    return failure(error, 'Could not save the machine type.', CODES);
  }
  return saved('Saved.');
}

export async function createMachineModel(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = MachineModelInput.safeParse({
    name: text(form, 'name'),
    brandId: nullable(text(form, 'brandId')),
    machineTypeId: nullable(text(form, 'machineTypeId')),
  });
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request('/inventory/machine-models', () => undefined, {
      method: 'POST',
      json: parsed.data,
    });
  } catch (error) {
    return failure(error, 'Could not add the machine model.', CODES);
  }
  return saved(`Machine model ${parsed.data.name} added.`);
}

const ModelUpdate = z.object({ id: z.uuid(), input: MachineModelInput });

export async function updateMachineModel(
  _prev: ActionState,
  payload: z.input<typeof ModelUpdate>,
): Promise<ActionState> {
  const parsed = ModelUpdate.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await api.request(
      `/inventory/machine-models/${parsed.data.id}`,
      () => undefined,
      { method: 'PATCH', json: parsed.data.input },
    );
  } catch (error) {
    return failure(error, 'Could not save the machine model.', CODES);
  }
  return saved('Saved.');
}
