'use client';

import { Button, Group, Select, Stack, Switch, TextInput } from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import {
  type LowStockSettingsDto,
  WEEKDAY_LABELS,
} from '@dax/inventory-contract';
import { StateAlert } from '../../../../../components/state-alert';
import { IDLE } from '../../../../../lib/action-state';
import { saveLowStockSettings } from './actions';

export function SettingsForm({ settings }: { settings: LowStockSettingsDto }) {
  const [weekday, setWeekday] = useState(String(settings.reportWeekday));
  const [time, setTime] = useState(settings.reportTime);
  const [instant, setInstant] = useState(settings.instantEmail);
  const [state, dispatch, pending] = useActionState(saveLowStockSettings, IDLE);

  return (
    <Stack maw={520}>
      <Group grow align="flex-start">
        <Select
          label="Weekly report day"
          data={WEEKDAY_LABELS.map((label, i) => ({
            value: String(i),
            label,
          }))}
          value={weekday}
          onChange={(v) => v && setWeekday(v)}
          allowDeselect={false}
          error={state.fields?.['reportWeekday']}
        />
        <TextInput
          label="Time (Sri Lanka)"
          type="time"
          value={time}
          onChange={(e) => setTime(e.currentTarget.value)}
          error={state.fields?.['reportTime']}
        />
      </Group>
      <Switch
        label="Email each part as soon as it drops below minimum"
        description="Off: department heads get only the weekly report by email. The inbox always shows new low parts straight away."
        checked={instant}
        onChange={(e) => setInstant(e.currentTarget.checked)}
      />
      <StateAlert state={state} />
      <Group>
        <Button
          loading={pending}
          onClick={() =>
            startTransition(() =>
              dispatch({
                reportWeekday: Number(weekday),
                reportTime: time,
                instantEmail: instant,
                version: settings.version,
              }),
            )
          }
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
