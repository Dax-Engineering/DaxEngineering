'use client';

import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import type { ItemDetail } from '@dax/inventory-contract';
import { AppLink } from '../../../../../components/links';
import { IDLE } from '../../../../../lib/action-state';
import { ItemPicker } from '../../_lib/pickers';
import { setReplacement } from './actions';

export function Replacement({
  item,
  canEdit,
}: {
  item: ItemDetail;
  canEdit: boolean;
}) {
  const [state, dispatch, pending] = useActionState(setReplacement, IDLE);
  const [choice, setChoice] = useState<string | null>(null);
  // Clear the picker once a save or remove lands, so it doesn't keep
  // offering the number that is now linked (or was just removed).
  const linked = item.supersededBy?.id ?? '';
  const [seenLink, setSeenLink] = useState(linked);
  if (seenLink !== linked) {
    setSeenLink(linked);
    setChoice(null);
  }
  const save = (replacementId: string | null) =>
    startTransition(() =>
      dispatch({ id: item.id, version: item.version, replacementId }),
    );

  return (
    <Stack gap="sm">
      {item.supersededBy ? (
        <Group justify="space-between" wrap="wrap">
          <Text size="sm">
            Superseded by{' '}
            <AppLink href={`/inventory/items/${item.supersededBy.id}`} fw={600}>
              <span className="dax-mono">{item.supersededBy.partNo}</span> (
              {item.supersededBy.brand})
            </AppLink>
          </Text>
          {canEdit ? (
            <Button
              variant="default"
              color="red"
              loading={pending}
              onClick={() => save(null)}
            >
              Remove
            </Button>
          ) : null}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          {item.supersedes.length
            ? 'This is the current part number of its family. Nothing newer has superseded it yet.'
            : 'Nothing has superseded this part number. It is the current one.'}
        </Text>
      )}
      {item.supersedes.length ? (
        <Text size="sm">
          It supersedes:{' '}
          {item.supersedes.map((old, i) => (
            <span key={old.id}>
              {i > 0 ? ', ' : ''}
              <AppLink href={`/inventory/items/${old.id}`}>
                <span className="dax-mono">{old.partNo}</span> ({old.brand})
              </AppLink>
            </span>
          ))}
        </Text>
      ) : null}
      {canEdit ? (
        <Group align="flex-end" gap="sm" wrap="wrap">
          <ItemPicker
            key={linked}
            label={
              item.supersededBy ? 'Change superseding number' : 'Superseded by'
            }
            excludeId={item.id}
            initial={null}
            value={choice}
            onChange={setChoice}
            style={{ flex: '1 1 260px' }}
            size="md"
          />
          <Button
            onClick={() => save(choice)}
            disabled={!choice}
            loading={pending}
            size="md"
          >
            Save
          </Button>
        </Group>
      ) : null}
      {state.error ? <Alert color="red">{state.error}</Alert> : null}
    </Stack>
  );
}
