'use client';

import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import { type ActionState, IDLE } from '../../../../../../lib/action-state';
import { rejectAod } from '../../_lib/actions';

export function RejectButton({ id, version }: { id: string; version: number }) {
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState('');
  const [state, dispatch, pending] = useActionState(
    async (prev: ActionState, payload: Parameters<typeof rejectAod>[1]) => {
      const result = await rejectAod(prev, payload);
      if (result.ok) setOpened(false);
      return result;
    },
    IDLE,
  );
  return (
    <>
      <Button variant="default" color="red" onClick={() => setOpened(true)}>
        Reject
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Reject this AOD?"
        centered
      >
        <Stack>
          <Text size="sm">
            It goes back to Stores with your reason, so they can fix it and send
            it again, or cancel it. No stock moves.
          </Text>
          <Textarea
            label="Reason"
            required
            autosize
            minRows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            error={state.fields?.['reason']}
            data-autofocus
          />
          {state.error ? <Alert color="red">{state.error}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              Not now
            </Button>
            <Button
              color="red"
              loading={pending}
              disabled={reason.trim().length < 5}
              onClick={() =>
                startTransition(() => dispatch({ id, version, reason }))
              }
            >
              Reject
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
