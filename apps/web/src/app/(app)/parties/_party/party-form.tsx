'use client';

import {
  Button,
  Checkbox,
  Group,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useActionState } from 'react';
import { StateAlert } from '../../../../components/state-alert';
import { fieldError, IDLE } from '../../../../lib/action-state';
import { saveParty } from './actions';
import { CONTACT_FIELDS, type PartyDto, type PartyKind } from './config';

function value(party: PartyDto | undefined, key: string): string {
  const v = party ? (party as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v : '';
}

export function PartyForm({
  kind,
  party,
  editable,
}: {
  kind: PartyKind;
  party?: PartyDto;
  /** Fields this user may change; on a new record the others are left out. */
  editable: readonly string[];
}) {
  const [state, action, pending] = useActionState(saveParty, IDLE);
  const err = (key: string) => fieldError(state, key);
  const has = (key: string) => (party ? key in party : editable.includes(key));
  const locked = (key: string) => !editable.includes(key);

  return (
    <form action={action}>
      <input type="hidden" name="kind" value={kind} />
      {party ? (
        <>
          <input type="hidden" name="id" value={party.id} />
          <input type="hidden" name="version" value={party.version} />
        </>
      ) : null}
      <Stack>
        <StateAlert state={state} />
        <TextInput
          name="name"
          label="Name"
          required
          maxLength={150}
          defaultValue={party?.name ?? ''}
          error={err('name')}
          size="md"
        />
        {kind === 'supplier' ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {has('country') ? (
              <TextInput
                name="country"
                label="Country"
                disabled={locked('country')}
                maxLength={60}
                defaultValue={value(party, 'country')}
                error={err('country')}
                size="md"
              />
            ) : null}
            <div>
              <input type="hidden" name="isForeignShown" value="1" />
              <Checkbox
                name="isForeign"
                label="Foreign supplier (imports)"
                defaultChecked={party?.isForeign ?? false}
                mt={{ base: 0, sm: 34 }}
                size="md"
              />
            </div>
          </SimpleGrid>
        ) : null}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {CONTACT_FIELDS.filter((f) => !f.multiline && has(f.key)).map((f) => (
            <TextInput
              key={f.key}
              name={f.key}
              label={f.label}
              disabled={locked(f.key)}
              type={
                f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'text'
              }
              defaultValue={value(party, f.key)}
              error={err(f.key)}
              size="md"
            />
          ))}
        </SimpleGrid>
        {CONTACT_FIELDS.filter((f) => f.multiline && has(f.key)).map((f) => (
          <Textarea
            key={f.key}
            name={f.key}
            label={f.label}
            disabled={locked(f.key)}
            autosize
            minRows={2}
            defaultValue={value(party, f.key)}
            error={err(f.key)}
            size="md"
          />
        ))}
        <Group>
          <Button type="submit" loading={pending} size="md">
            {party ? 'Save changes' : 'Add'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
