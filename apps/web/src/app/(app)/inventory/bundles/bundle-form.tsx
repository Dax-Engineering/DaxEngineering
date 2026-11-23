'use client';

import { Button, Stack, Textarea, TextInput } from '@mantine/core';
import { startTransition, useActionState, useState } from 'react';
import type { BundleDto } from '@dax/inventory-contract';
import { StateAlert } from '../../../../components/state-alert';
import { fieldError, IDLE } from '../../../../lib/action-state';
import { trimQty } from '../../../../lib/format';
import { type RequestLine, RequestLines } from '../issuing/_lib/request-lines';
import { saveBundle } from './actions';

export function BundleForm({ bundle }: { bundle?: BundleDto }) {
  const [state, dispatch, pending] = useActionState(saveBundle, IDLE);
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [lines, setLines] = useState<RequestLine[]>(
    bundle?.lines.map((l) => ({
      key: l.item.id,
      part: l.item,
      qty: trimQty(l.qty),
      notes: '',
    })) ?? [],
  );
  const err = (key: string) => fieldError(state, key);

  function send() {
    const body = {
      name,
      description,
      lines: lines.map((l) => ({ itemId: l.part.id, qty: l.qty.trim() })),
      ...(bundle ? { version: bundle.version } : {}),
    };
    startTransition(() => dispatch({ id: bundle?.id, body }));
  }

  return (
    <Stack gap="lg">
      <StateAlert state={state} />
      <TextInput
        label="Bundle name"
        description="The customer sees this on their AOD, like 500-hr service kit"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        error={err('name')}
        size="md"
      />
      <Textarea
        label="Description (optional)"
        autosize
        minRows={2}
        maxLength={300}
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        error={err('description')}
        size="md"
      />
      <RequestLines
        title="Parts in one set"
        qtyLabel="Per set"
        emptyText="Scan or search for each part in one set."
        lines={lines}
        onChange={setLines}
        errors={err}
      />
      <div className="dax-bar">
        <span className="note">
          MRNs copy the parts when they are raised. Changing the bundle later
          does not change them.
        </span>
        <Button size="lg" loading={pending} onClick={send}>
          {bundle ? 'Save' : 'Save bundle'}
        </Button>
      </div>
    </Stack>
  );
}
