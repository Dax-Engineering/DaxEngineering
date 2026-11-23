'use client';

import {
  Button,
  type ButtonProps,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import { useState } from 'react';
import { SERIAL_LABELS_PER_SHEET } from '@dax/inventory-contract';
import { Icon } from '@dax/web-shell';

/** What to print: exactly one of these. */
export interface SerialScope {
  serialIds?: string[];
  grnId?: string;
  grnLineId?: string;
  itemId?: string;
  binIds?: string[];
  zoneId?: string;
}

function Hidden({ scope }: { scope: SerialScope }) {
  const one = (name: string, value?: string) =>
    value ? <input type="hidden" name={name} value={value} /> : null;
  const many = (name: string, values?: string[]) =>
    values?.map((v) => <input key={v} type="hidden" name={name} value={v} />);
  return (
    <>
      {many('serialIds', scope.serialIds)}
      {one('grnId', scope.grnId)}
      {one('grnLineId', scope.grnLineId)}
      {one('itemId', scope.itemId)}
      {many('binIds', scope.binIds)}
      {one('zoneId', scope.zoneId)}
    </>
  );
}

/** Opens the serial label sheet (A4, 3 × 10) for a GRN, a line, a part, bins or chosen serials. */
export function SerialLabelsButton({
  scope,
  label = 'Print serial labels',
  count,
  unprintedOnly = false,
  offerUnprinted = true,
  ...button
}: {
  scope: SerialScope;
  label?: string;
  /** Labels in scope, when known, to show how many sheets. */
  count?: number;
  /** Start with "only labels not printed yet" switched on. */
  unprintedOnly?: boolean;
  offerUnprinted?: boolean;
} & ButtonProps) {
  const [opened, setOpened] = useState(false);
  const [skip, setSkip] = useState(0);
  const [unprinted, setUnprinted] = useState(unprintedOnly);
  const sheets =
    count === undefined
      ? null
      : Math.ceil((count + skip) / SERIAL_LABELS_PER_SHEET);

  return (
    <>
      <Button
        variant="default"
        leftSection={<Icon name="printer" size={18} />}
        onClick={() => setOpened(true)}
        {...button}
      >
        {label}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Print serial labels"
        centered
      >
        <form
          method="post"
          action="/api/serial-labels"
          target="_blank"
          onSubmit={() => window.setTimeout(() => setOpened(false), 0)}
        >
          <Hidden scope={scope} />
          <input type="hidden" name="unprinted" value={String(unprinted)} />
          <Stack>
            <Text size="sm">
              One label per serial, with its Code 128 barcode, on A4 sticker
              sheets of {SERIAL_LABELS_PER_SHEET} (3 across, 10 down). The PDF
              opens in a new tab.
            </Text>
            {offerUnprinted ? (
              <Switch
                label="Only labels not printed yet"
                description="Off: reprint every serial here. Reprints are recorded."
                checked={unprinted}
                onChange={(e) => setUnprinted(e.currentTarget.checked)}
              />
            ) : null}
            <NumberInput
              name="skip"
              label="Skip labels already used"
              description="For a partly used sheet: how many labels are gone from the top, counting left to right."
              min={0}
              max={SERIAL_LABELS_PER_SHEET - 1}
              clampBehavior="strict"
              allowDecimal={false}
              allowNegative={false}
              value={skip}
              onChange={(v) => setSkip(typeof v === 'number' && v >= 0 ? v : 0)}
              size="md"
            />
            {sheets !== null && !unprinted ? (
              <Text size="sm" c="dimmed">
                {count} {count === 1 ? 'label' : 'labels'} on {sheets}{' '}
                {sheets === 1 ? 'sheet' : 'sheets'}.
              </Text>
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpened(false)}>
                Cancel
              </Button>
              <Button type="submit">Open PDF</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
