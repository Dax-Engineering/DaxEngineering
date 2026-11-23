'use client';

import {
  ActionIcon,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useState, useTransition } from 'react';
import type { MrnDto } from '@dax/inventory-contract';
import { Icon, Mono, Pill } from '@dax/web-shell';
import { formatQty, trimQty } from '../../../../../lib/format';
import { loadBundle } from '../../bundles/actions';
import { QtyStepper } from '../../receiving/_lib/qty-stepper';
import type { PickerOption } from '../../_lib/search-actions';
import { setsText } from '../_lib/bundle-groups';
import { type RequestLine, RequestLines } from '../_lib/request-lines';

export interface BundleDraft {
  key: string;
  /** Set for a saved bundle; its parts are fixed. Null for a one-off bundle. */
  bundleId: string | null;
  name: string;
  sets: string;
  lines: RequestLine[];
}

export function draftsFrom(mrn: MrnDto): BundleDraft[] {
  return mrn.bundles.map((b) => ({
    key: b.id,
    bundleId: b.bundleId,
    name: b.name,
    sets: String(b.qtySets),
    lines: mrn.lines
      .filter((l) => l.bundleId === b.id)
      .map((l) => ({
        key: l.id,
        part: { ...l.item, free: l.freeNow },
        qty: trimQty(l.qtyPerSet ?? '1'),
        notes: '',
      })),
  }));
}

export function bundlesBody(drafts: BundleDraft[]) {
  return drafts.map((b) => ({
    bundleId: b.bundleId,
    name: b.name.trim(),
    qtySets: Number(b.sets) || 0,
    lines: b.lines.map((l) => ({ itemId: l.part.id, qtyPerSet: l.qty.trim() })),
  }));
}

function BundleCard({
  draft,
  index,
  onChange,
  onRemove,
  errors,
}: {
  draft: BundleDraft;
  index: number;
  onChange: (change: Partial<BundleDraft>) => void;
  onRemove: () => void;
  errors: (key: string) => string | undefined;
}) {
  const at = (key: string) => errors(`bundles.${index}.${key}`);
  const saved = draft.bundleId !== null;
  return (
    <div className="dax-bundle">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="xs" align="center">
          <Pill tone="ext">{saved ? 'Saved bundle' : 'One-off bundle'}</Pill>
          {saved ? (
            <Text fw={700} size="lg">
              {draft.name}
            </Text>
          ) : null}
        </Group>
        <ActionIcon
          size="lg"
          variant="subtle"
          color="red"
          aria-label={`Remove ${draft.name || 'bundle'}`}
          onClick={onRemove}
        >
          <Icon name="close" size={20} />
        </ActionIcon>
      </Group>
      {saved ? null : (
        <TextInput
          label="Bundle name"
          description="The customer sees this on their AOD"
          maxLength={80}
          size="md"
          value={draft.name}
          error={at('name')}
          onChange={(e) => onChange({ name: e.currentTarget.value })}
        />
      )}
      <div className="dax-steppers">
        <QtyStepper
          label="Sets"
          unit="SET"
          value={draft.sets}
          error={at('qtySets')}
          onChange={(sets) => onChange({ sets })}
        />
      </div>
      {saved ? (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Each set has
          </Text>
          {draft.lines.map((l) => (
            <span key={l.key} className="dax-sub">
              {formatQty(l.qty)} {l.part.uom} × <Mono>{l.part.partNo}</Mono>{' '}
              {l.part.description}
            </span>
          ))}
          <span className="dax-sub">
            {setsText(Number(draft.sets) || 0)} in all
          </span>
        </Stack>
      ) : (
        <RequestLines
          title="Parts in one set"
          qtyLabel="Per set"
          emptyText="Scan or search for each part in one set."
          lines={draft.lines}
          onChange={(lines) => onChange({ lines })}
          errors={(key) =>
            at(key.replace(/^lines\.(\d+)\.qty$/, 'lines.$1.qtyPerSet'))
          }
        />
      )}
    </div>
  );
}

export function MrnBundles({
  drafts,
  onChange,
  saved,
  errors,
}: {
  drafts: BundleDraft[];
  onChange: (drafts: BundleDraft[]) => void;
  /** Saved bundles this person may pick; empty hides the picker. */
  saved: PickerOption[];
  errors: (key: string) => string | undefined;
}) {
  const [loading, startLoading] = useTransition();
  const [missing, setMissing] = useState<string | null>(null);

  function addSaved(id: string | null) {
    if (!id) return;
    setMissing(null);
    startLoading(async () => {
      const bundle = await loadBundle(id);
      if (!bundle) {
        setMissing('That bundle could not be loaded. Reload and try again.');
        return;
      }
      onChange([
        ...drafts,
        {
          key: `${bundle.id}-${Date.now()}`,
          bundleId: bundle.id,
          name: bundle.name,
          sets: '1',
          lines: bundle.lines.map((l) => ({
            key: l.item.id,
            part: l.item,
            qty: trimQty(l.qty),
            notes: '',
          })),
        },
      ]);
    });
  }

  const patch = (key: string, change: Partial<BundleDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...change } : d)));

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={700} size="lg">
          Bundles
        </Text>
        <Text c="dimmed" size="sm">
          Sets of parts that go out together
        </Text>
      </Group>
      {drafts.map((d, i) => (
        <BundleCard
          key={d.key}
          draft={d}
          index={i}
          errors={errors}
          onChange={(change) => patch(d.key, change)}
          onRemove={() => onChange(drafts.filter((x) => x.key !== d.key))}
        />
      ))}
      {missing ? (
        <Text c="red" size="sm">
          {missing}
        </Text>
      ) : null}
      <Group align="flex-end">
        {saved.length ? (
          <Select
            size="md"
            searchable
            placeholder="Add a saved bundle"
            aria-label="Add a saved bundle"
            data={saved}
            value={null}
            disabled={loading}
            onChange={addSaved}
            nothingFoundMessage="No bundle by that name"
          />
        ) : null}
        <Button
          size="md"
          variant="default"
          leftSection={<Icon name="plus" size={18} />}
          onClick={() =>
            onChange([
              ...drafts,
              {
                key: `one-off-${Date.now()}`,
                bundleId: null,
                name: '',
                sets: '1',
                lines: [],
              },
            ])
          }
        >
          One-off bundle
        </Button>
      </Group>
    </Stack>
  );
}
