'use client';

import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { startTransition, useActionState, useRef } from 'react';
import { BARCODE_KINDS, type ItemDetail } from '@dax/inventory-contract';
import { Mono } from '@dax/web-shell';
import { StateAlert } from '../../../../../components/state-alert';
import { fieldError, IDLE } from '../../../../../lib/action-state';
import { addBarcode, removeBarcode } from './actions';

const KIND_LABELS: Record<(typeof BARCODE_KINDS)[number], string> = {
  MANUFACTURER: "Maker's barcode",
  SUPPLIER: "Supplier's barcode",
  ALTERNATE: 'Other barcode',
};

export function Barcodes({
  item,
  canEdit,
}: {
  item: ItemDetail;
  canEdit: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [added, add, adding] = useActionState(
    async (prev: Parameters<typeof addBarcode>[0], data: FormData) => {
      const result = await addBarcode(prev, data);
      if (result.ok) form.current?.reset();
      return result;
    },
    IDLE,
  );
  const [removed, remove, removing] = useActionState(removeBarcode, IDLE);

  return (
    <Stack gap="sm">
      {item.barcodes.length ? (
        <Stack gap={6}>
          {item.barcodes.map((b) => (
            <Group key={b.id} justify="space-between" wrap="nowrap">
              <Text size="sm">
                <Mono>{b.code}</Mono>{' '}
                <Text span size="xs" c="dimmed">
                  {KIND_LABELS[b.kind]}
                </Text>
              </Text>
              {canEdit ? (
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  loading={removing}
                  onClick={() =>
                    startTransition(() =>
                      remove({ id: item.id, barcodeId: b.id }),
                    )
                  }
                >
                  Remove
                </Button>
              ) : null}
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          No barcodes yet. Scanning a barcode finds the part once it is added
          here.
        </Text>
      )}
      {removed.error ? <Alert color="red">{removed.error}</Alert> : null}
      {canEdit ? (
        <form ref={form} action={add}>
          <input type="hidden" name="id" value={item.id} />
          <Stack gap="sm">
            <StateAlert state={added} />
            <Group align="flex-start" gap="sm" wrap="wrap">
              <TextInput
                name="code"
                label="Barcode"
                description="Scan it or type it as printed."
                required
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
                error={fieldError(added, 'code')}
                style={{ flex: '1 1 220px' }}
                size="md"
              />
              <Select
                name="kind"
                label="Type"
                description="Where the barcode comes from."
                data={BARCODE_KINDS.map((k) => ({
                  value: k,
                  label: KIND_LABELS[k],
                }))}
                defaultValue="MANUFACTURER"
                allowDeselect={false}
                style={{ flex: '0 1 220px' }}
                size="md"
              />
            </Group>
            <Group>
              <Button type="submit" loading={adding}>
                Add barcode
              </Button>
            </Group>
          </Stack>
        </form>
      ) : null}
    </Stack>
  );
}
