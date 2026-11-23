'use client';

import { Button, Group, Text } from '@mantine/core';
import { startTransition, useActionState } from 'react';
import type { InboxMessageDto } from '@dax/platform-contract';
import { IDLE } from '../../../lib/action-state';
import { markDone, openMessage } from './actions';

export function MessageRow({
  message,
  when,
}: {
  message: InboxMessageDto;
  when: string;
}) {
  const [state, dispatch, pending] = useActionState(markDone, IDLE);
  const unread = message.readAt === null && message.doneAt === null;
  return (
    <li className="dax-inbox-row" data-unread={unread ? 'true' : undefined}>
      <form action={openMessage.bind(null, message.id, message.link)}>
        <button type="submit" className="dax-inbox-open">
          <span className="t">{message.title}</span>
          <span className="s">{message.body}</span>
          <span className="s">{when}</span>
        </button>
      </form>
      {message.doneAt === null ? (
        <Group gap="xs" wrap="nowrap">
          {state.error ? (
            <Text size="sm" c="red">
              {state.error}
            </Text>
          ) : null}
          <Button
            variant="default"
            size="xs"
            loading={pending}
            onClick={() => startTransition(() => dispatch(message.id))}
          >
            Mark done
          </Button>
        </Group>
      ) : null}
    </li>
  );
}
