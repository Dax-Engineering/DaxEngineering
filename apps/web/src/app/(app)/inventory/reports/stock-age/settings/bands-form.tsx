'use client';

import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Stack,
  Text,
} from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import {
  STOCK_AGE_DEFAULT_BANDS,
  STOCK_AGE_MAX_BANDS,
  STOCK_AGE_MAX_DAYS,
  type StockAgeSettingsDto,
  stockAgeBandLabels,
} from '@dax/inventory-contract';
import { Icon } from '@dax/web-shell';
import { StateAlert } from '../../../../../../components/state-alert';
import { IDLE } from '../../../../../../lib/action-state';
import { saveStockAgeBands } from './actions';

export function BandsForm({ settings }: { settings: StockAgeSettingsDto }) {
  const [limits, setLimits] = useState<number[]>(settings.bands);
  const [state, dispatch, pending] = useActionState(saveStockAgeBands, IDLE);
  const ordered = limits.every((d, i) => i === 0 || d > (limits[i - 1] ?? 0));
  const labels = ordered ? stockAgeBandLabels(limits) : [];

  const set = (i: number, value: number) =>
    setLimits(limits.map((d, j) => (j === i ? value : d)));

  return (
    <Stack maw={520}>
      {limits.map((limit, i) => (
        <Group key={i} align="flex-end" wrap="nowrap">
          <NumberInput
            label={`Band ${i + 1} ends at`}
            suffix=" days"
            min={1}
            max={STOCK_AGE_MAX_DAYS}
            allowDecimal={false}
            value={limit}
            onChange={(v) => set(i, typeof v === 'number' ? v : Number(v) || 0)}
            style={{ flex: 1 }}
          />
          <ActionIcon
            size="lg"
            variant="subtle"
            color="red"
            aria-label={`Remove band ${i + 1}`}
            disabled={limits.length <= 2}
            onClick={() => setLimits(limits.filter((_, j) => j !== i))}
          >
            <Icon name="close" size={20} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button
          variant="default"
          leftSection={<Icon name="plus" size={18} />}
          disabled={limits.length >= STOCK_AGE_MAX_BANDS}
          onClick={() =>
            setLimits([...limits, (limits[limits.length - 1] ?? 0) + 365])
          }
        >
          Add a band
        </Button>
        <Button
          variant="subtle"
          onClick={() => setLimits([...STOCK_AGE_DEFAULT_BANDS])}
        >
          Use the standard bands
        </Button>
      </Group>
      <Text size="sm" c={ordered ? 'dimmed' : 'red'}>
        {ordered
          ? `The report will show: ${labels.map((l) => `${l} days`).join(' · ')}`
          : 'Each band must end later than the one before it.'}
      </Text>
      <StateAlert state={state} />
      <Group>
        <Button
          loading={pending}
          disabled={!ordered}
          onClick={() =>
            startTransition(() =>
              dispatch({ bands: limits, version: settings.version }),
            )
          }
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
