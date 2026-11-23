'use client';

import {
  Alert,
  Anchor,
  Button,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  type ItemDetail,
  type PhoneScanLineDto,
  type PhoneScanSuggestion,
  type PhoneScanView,
} from '@dax/inventory-contract';
import { Mono, Pill, useCan } from '@dax/web-shell';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PrintLabelsButton } from '../../../../components/labels';
import { formatQty, UOM_OPTIONS } from '../../../../lib/format';
import { ItemPicker } from '../../inventory/_lib/pickers';
import {
  createItemForLine,
  getBrands,
  getLineItem,
  getLineSuggestion,
  linkLine,
  type PhoneResult,
  setPhoneScanQty,
} from './actions';

/** Runs a change on the list; resolves to the error message, or null. */
type Act = (
  fn: () => Promise<PhoneResult<PhoneScanView>>,
) => Promise<string | null>;

function QtyStepper({
  line,
  act,
  sessionId,
}: {
  line: PhoneScanLineDto;
  act: Act;
  sessionId: string;
}) {
  const [value, setValue] = useState(line.qty);
  useEffect(() => setValue(line.qty), [line.qty]);
  const save = (qty: string) =>
    void act(() => setPhoneScanQty(sessionId, line.id, qty));
  const n = Number(line.qty);
  return (
    <Group gap="xs" wrap="nowrap">
      <Button
        variant="default"
        disabled={n <= 1}
        onClick={() => save(String(Math.max(1, n - 1)))}
        aria-label="One less"
      >
        −
      </Button>
      <TextInput
        aria-label="Quantity"
        value={value}
        w={90}
        inputMode="decimal"
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => {
          const v = value.trim();
          if (
            v !== line.qty &&
            /^\d{1,11}(\.\d{1,3})?$/.test(v) &&
            Number(v) > 0
          )
            save(v);
          else setValue(line.qty);
        }}
        styles={{ input: { textAlign: 'center' } }}
      />
      <Button
        variant="default"
        onClick={() => save(String(n + 1))}
        aria-label="One more"
      >
        +
      </Button>
      <Text c="dimmed" size="sm">
        {line.item?.uom ?? ''}
      </Text>
    </Group>
  );
}

function KnownPart({
  line,
  sessionId,
  act,
}: {
  line: PhoneScanLineDto & { item: NonNullable<PhoneScanLineDto['item']> };
  sessionId: string;
  act: Act;
}) {
  const canPrint = useCan('inventory.item.print_label');
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getLineItem(line.item.id).then((r) => {
      if (!live) return;
      if (r.ok) setItem(r.data);
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [line.item.id, line.qty]);

  const s = item?.stock;
  const free = s
    ? Number(s.onHand) -
      Number(s.held) -
      Number(s.quarantine) -
      Number(s.receiving)
    : 0;

  return (
    <Stack gap="lg">
      <div>
        <Text fw={700} size="lg">
          <Mono>{line.item.partNo}</Mono>{' '}
          <span className="dax-muted">{line.item.brand}</span>
        </Text>
        <Text c="dimmed">{line.item.description}</Text>
        <Anchor
          component={Link}
          href={`/inventory/items/${line.item.id}`}
          size="sm"
        >
          Open the item
        </Anchor>
      </div>

      <div>
        <Text fw={600} mb={6}>
          Quantity on this list
        </Text>
        <QtyStepper line={line} act={act} sessionId={sessionId} />
      </div>

      <div>
        <Text fw={600} mb={6}>
          Stock
        </Text>
        {error ? <Alert color="red">{error}</Alert> : null}
        {!item && !error ? <Loader size="sm" /> : null}
        {s ? (
          <>
            <div className="dax-figs-mini">
              <span>
                On hand <b>{formatQty(s.onHand)}</b>
              </span>
              <span>
                Free <b>{formatQty(String(free))}</b>
              </span>
              <span>
                Held <b>{formatQty(s.held)}</b>
              </span>
            </div>
            {item?.stockByBin.length ? (
              <ul className="dax-bin-list">
                {item.stockByBin.map((b) => (
                  <li key={b.binId}>
                    <Mono>{b.binCode}</Mono> <b>{formatQty(b.qty)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <Text size="sm" c="dimmed">
                Not in any bin.
              </Text>
            )}
          </>
        ) : null}
      </div>

      <Group gap="sm">
        {canPrint ? (
          <PrintLabelsButton
            kind="item"
            ids={[line.item.id]}
            label="Print its label"
          />
        ) : null}
      </Group>
    </Stack>
  );
}

const SOURCE_NOTE: Record<
  NonNullable<PhoneScanSuggestion['source']>,
  string
> = {
  barcode: 'The part number was read from the barcode.',
  similar: 'The brand is a guess from other barcodes that start the same way.',
  online: 'Details came from an online product database. Check them.',
};

function NewPart({
  line,
  sessionId,
  act,
}: {
  line: PhoneScanLineDto;
  sessionId: string;
  act: Act;
}) {
  const canCreate = useCan('inventory.item.create');
  const [suggestion, setSuggestion] = useState<PhoneScanSuggestion | null>(
    null,
  );
  const [brands, setBrands] = useState<{ value: string; label: string }[]>([]);
  const [mode, setMode] = useState<'new' | 'link'>(canCreate ? 'new' : 'link');
  const [form, setForm] = useState({
    partNo: '',
    brandId: null as string | null,
    description: '',
    uom: 'PCS',
    minQty: '0',
  });
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getLineSuggestion(sessionId, line.id), getBrands()]).then(
      ([s, b]) => {
        if (!live) return;
        if (b.ok)
          setBrands(b.data.map((x) => ({ value: x.id, label: x.name })));
        if (!s.ok) return setError(s.message);
        setSuggestion(s.data);
        setForm((f) => ({
          ...f,
          partNo: s.data.partNo ?? f.partNo,
          brandId: s.data.brand?.id ?? f.brandId,
          description: s.data.description ?? f.description,
        }));
      },
    );
    return () => {
      live = false;
    };
  }, [sessionId, line.id]);

  async function run(fn: () => Promise<PhoneResult<PhoneScanView>>) {
    setSaving(true);
    setError(null);
    const failed = await act(fn);
    setSaving(false);
    if (failed) setError(failed);
  }

  const brandMissing =
    suggestion?.brand && !suggestion.brand.id ? suggestion.brand.name : null;

  return (
    <Stack gap="lg">
      <div>
        <Pill tone={line.matches > 1 ? 'yel' : 'bad'}>
          {line.matches > 1
            ? `Matches ${line.matches} items`
            : 'Not in the system'}
        </Pill>
        <Text mt={6}>
          Scanned code <Mono>{line.code}</Mono> · ×{line.qty}
        </Text>
        {suggestion?.gtin ? (
          <Text size="sm" c="dimmed">
            Product number in the barcode: <Mono>{suggestion.gtin}</Mono>
          </Text>
        ) : null}
        {line.photoId ? (
          <Anchor href={`/files/${line.photoId}`} target="_blank" size="sm">
            View the label photo from the phone
          </Anchor>
        ) : null}
      </div>

      {error ? <Alert color="red">{error}</Alert> : null}
      {!suggestion && !error ? <Loader size="sm" /> : null}

      {suggestion && suggestion.matches.length > 0 ? (
        <Stack gap="xs">
          <Text fw={600}>Which part is it?</Text>
          {suggestion.matches.map((m) => (
            <Button
              key={m.id}
              variant="default"
              justify="flex-start"
              disabled={saving}
              onClick={() =>
                void run(() => linkLine(sessionId, line.id, m.id, false))
              }
            >
              <Mono>{m.partNo}</Mono>&nbsp;
              <span className="dax-muted">
                {m.brand} · {m.description}
              </span>
            </Button>
          ))}
        </Stack>
      ) : null}

      {suggestion ? (
        <Stack gap="md">
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as 'new' | 'link')}
            data={[
              {
                value: 'new',
                label: 'Add as a new item',
                disabled: !canCreate,
              },
              { value: 'link', label: 'Link to an existing item' },
            ]}
          />
          {mode === 'new' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.brandId) return setError('Choose a brand.');
                void run(() =>
                  createItemForLine(sessionId, line.id, {
                    ...form,
                    brandId: form.brandId as string,
                  }),
                );
              }}
            >
              <Stack gap="sm">
                {suggestion.source ? (
                  <Text size="sm" c="dimmed">
                    {SOURCE_NOTE[suggestion.source]}
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    Nothing could be read from this barcode. Type the details.
                  </Text>
                )}
                <TextInput
                  label="Part number"
                  required
                  value={form.partNo}
                  onChange={(e) =>
                    setForm({ ...form, partNo: e.currentTarget.value })
                  }
                />
                <Select
                  label="Brand"
                  required
                  searchable
                  data={brands}
                  value={form.brandId}
                  onChange={(v) => setForm({ ...form, brandId: v })}
                  description={
                    brandMissing
                      ? `Suggested: ${brandMissing}. It isn't in the list yet; add it under Brands and models.`
                      : undefined
                  }
                />
                <TextInput
                  label="Description"
                  required
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.currentTarget.value })
                  }
                />
                <Group grow>
                  <Select
                    label="Unit"
                    required
                    data={UOM_OPTIONS}
                    value={form.uom}
                    onChange={(v) => setForm({ ...form, uom: v ?? 'PCS' })}
                  />
                  <TextInput
                    label="Minimum stock"
                    inputMode="decimal"
                    value={form.minQty}
                    onChange={(e) =>
                      setForm({ ...form, minQty: e.currentTarget.value })
                    }
                  />
                </Group>
                <Button type="submit" loading={saving}>
                  Add item
                </Button>
              </Stack>
            </form>
          ) : (
            <Stack gap="sm">
              <ItemPicker
                label="Item"
                placeholder="Search by part number or description"
                initial={null}
                value={pick}
                onChange={setPick}
              />
              <Button
                disabled={!pick}
                loading={saving}
                onClick={() =>
                  pick &&
                  void run(() => linkLine(sessionId, line.id, pick, false))
                }
              >
                Link
              </Button>
            </Stack>
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}

export function LineDetails({
  sessionId,
  line,
  onClose,
  act,
}: {
  sessionId: string;
  line: PhoneScanLineDto | null;
  onClose: () => void;
  act: Act;
}) {
  return (
    <Drawer
      opened={line !== null}
      onClose={onClose}
      position="right"
      size="md"
      title={line?.item ? 'Scanned part' : 'Unknown code'}
    >
      {line?.item ? (
        <KnownPart
          key={line.id}
          line={{ ...line, item: line.item }}
          sessionId={sessionId}
          act={act}
        />
      ) : line ? (
        <NewPart key={line.id} line={line} sessionId={sessionId} act={act} />
      ) : null}
    </Drawer>
  );
}
