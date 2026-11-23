'use client';

import {
  Alert,
  Button,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import type { PhoneScanLineDto } from '@dax/inventory-contract';
import { Icon } from '@dax/web-shell';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PrintLabelsButton } from '../../../../components/labels';
import { BinPicker, RemotePicker } from '../../inventory/_lib/pickers';
import { searchCustomers } from '../../inventory/issuing/_lib/actions';
import { MRN_SUBTYPE_OPTIONS } from '../../inventory/issuing/_lib/labels';
import { searchSuppliers } from '../../inventory/receiving/_lib/actions';
import {
  countList,
  receiveList,
  requestList,
  type UseResult,
} from './use-actions';

export interface UseListAccess {
  receive: boolean;
  request: boolean;
  count: boolean;
  labels: boolean;
}

export type UseAction = 'receive' | 'request' | 'count' | 'labels';

/** An action asked for from one line's menu, or from the bar. */
export interface UseRequest {
  action: UseAction;
  lineIds: string[];
}

function partsText(n: number): string {
  return `${n} known ${n === 1 ? 'part' : 'parts'}`;
}

/**
 * Turns scanned lines into real work: a draft GRN, a draft request, a bin
 * count, or labels. Works on the ticked lines, one line from its menu, or the
 * whole list. Only known parts are used.
 */
export function UseList({
  sessionId,
  lines,
  selected,
  departments,
  access,
  request,
  onRequest,
  onClear,
  onRemove,
}: {
  sessionId: string;
  lines: PhoneScanLineDto[];
  /** Ticked line ids; empty means "the whole list". */
  selected: string[];
  departments: { id: string; name: string }[];
  access: UseListAccess;
  request: UseRequest | null;
  onRequest: (request: UseRequest | null) => void;
  onClear: () => void;
  onRemove: (lineIds: string[]) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [bin, setBin] = useState<string | null>(null);
  const [mrn, setMrn] = useState({
    subtype: 'PRT',
    departmentId:
      departments.length === 1 ? (departments[0]?.id ?? null) : null,
    customerId: null as string | null,
    jobNumber: '',
  });

  useEffect(() => {
    if (request) setError(null);
  }, [request]);

  const scopeIds = selected.length ? selected : lines.map((l) => l.id);
  const inScope = (ids: string[]) => {
    const set = new Set(ids);
    return lines.filter((l) => set.has(l.id));
  };
  const scoped = inScope(scopeIds);
  const known = scoped.filter((l) => l.item !== null);
  const unknown = scoped.length - known.length;

  // What the open window works on.
  const target = request ? inScope(request.lineIds) : [];
  const targetKnown = target.filter((l) => l.item !== null);
  const targetItems = [
    ...new Set(targetKnown.flatMap((l) => (l.item ? [l.item.id] : []))),
  ];
  const targetText =
    target.length === 1 && targetKnown[0]?.item
      ? targetKnown[0].item.partNo
      : partsText(targetKnown.length);

  async function go(run: () => Promise<UseResult>) {
    setSaving(true);
    setError(null);
    const result = await run().catch((): UseResult => ({
      ok: false,
      message: 'That did not work. Try again.',
    }));
    setSaving(false);
    if (result.ok) router.push(result.path);
    else setError(result.message);
  }

  const close = () => onRequest(null);
  const ask = (action: UseAction) =>
    onRequest({ action, lineIds: known.map((l) => l.id) });
  const lineIds = request?.lineIds ?? [];

  if (!lines.length) return null;

  return (
    <div
      className="dax-pp-use"
      data-selected={selected.length > 0 || undefined}
    >
      <div className="dax-pp-use-text">
        <b>
          {selected.length ? `${selected.length} selected` : 'Use this list'}
        </b>
        <span>
          {partsText(known.length)}
          {unknown
            ? ` · ${unknown} unknown ${unknown === 1 ? 'code' : 'codes'} left out`
            : ''}
        </span>
      </div>
      <div className="dax-pp-use-actions">
        {access.receive ? (
          <Button
            size="sm"
            radius="xl"
            disabled={!known.length}
            leftSection={<Icon name="truck" size={16} />}
            onClick={() => ask('receive')}
          >
            Raise GRN
          </Button>
        ) : null}
        {access.request ? (
          <Button
            size="sm"
            radius="xl"
            variant="light"
            disabled={!known.length}
            leftSection={<Icon name="send" size={16} />}
            onClick={() => ask('request')}
          >
            Raise MRN
          </Button>
        ) : null}
        {access.count ? (
          <Button
            size="sm"
            radius="xl"
            variant="light"
            disabled={!known.length}
            leftSection={<Icon name="clipboard" size={16} />}
            onClick={() => ask('count')}
          >
            Count
          </Button>
        ) : null}
        {access.labels ? (
          <Button
            size="sm"
            radius="xl"
            variant="light"
            disabled={!known.length}
            leftSection={<Icon name="printer" size={16} />}
            onClick={() => ask('labels')}
          >
            Labels
          </Button>
        ) : null}
        {selected.length ? (
          <>
            <Button
              size="sm"
              radius="xl"
              variant="subtle"
              color="red"
              onClick={() => onRemove(selected)}
            >
              Remove
            </Button>
            <Button size="sm" radius="xl" variant="default" onClick={onClear}>
              Clear
            </Button>
          </>
        ) : null}
      </div>

      <Modal
        opened={request?.action === 'receive'}
        onClose={close}
        title="Raise GRN"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Makes a draft GRN with {targetText} and the scanned quantities.
            Check it, then post and put away as usual.
          </Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          <RemotePicker
            label="Supplier"
            placeholder="Search suppliers"
            search={searchSuppliers}
            initial={null}
            value={supplier}
            onChange={setSupplier}
          />
          <Button
            disabled={!supplier || !targetKnown.length}
            loading={saving}
            onClick={() =>
              supplier &&
              void go(() => receiveList(sessionId, supplier, lineIds))
            }
          >
            Make the GRN
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={request?.action === 'request'}
        onClose={close}
        title="Raise MRN"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Makes a draft MRN with {targetText} and the scanned quantities,
            ready to submit.
          </Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          <Select
            label="Type"
            data={MRN_SUBTYPE_OPTIONS}
            value={mrn.subtype}
            onChange={(v) => setMrn({ ...mrn, subtype: v ?? 'PRT' })}
          />
          <Select
            label="Department"
            required
            data={departments.map((d) => ({ value: d.id, label: d.name }))}
            value={mrn.departmentId}
            onChange={(v) => setMrn({ ...mrn, departmentId: v })}
          />
          <RemotePicker
            label="Customer"
            placeholder="Optional"
            search={searchCustomers}
            initial={null}
            value={mrn.customerId}
            onChange={(v) => setMrn({ ...mrn, customerId: v })}
            clearable
          />
          <TextInput
            label="Job number"
            placeholder="Optional"
            value={mrn.jobNumber}
            onChange={(e) =>
              setMrn({ ...mrn, jobNumber: e.currentTarget.value })
            }
          />
          <Button
            disabled={!mrn.departmentId || !targetKnown.length}
            loading={saving}
            onClick={() =>
              mrn.departmentId &&
              void go(() =>
                requestList(
                  sessionId,
                  {
                    subtype: mrn.subtype,
                    departmentId: mrn.departmentId as string,
                    customerId: mrn.customerId,
                    jobNumber: mrn.jobNumber,
                  },
                  lineIds,
                ),
              )
            }
          >
            Raise MRN
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={request?.action === 'count'}
        onClose={close}
        title="Count in a bin"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Starts a cycle count of one bin with {targetText} counted as
            scanned. Anything else in that bin is left for you to count on the
            sheet.
          </Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          <BinPicker label="Bin" initial={null} value={bin} onChange={setBin} />
          <Button
            disabled={!bin || !targetKnown.length}
            loading={saving}
            onClick={() =>
              bin && void go(() => countList(sessionId, bin, lineIds))
            }
          >
            Start the count
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={request?.action === 'labels'}
        onClose={close}
        title="Print labels"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            QR labels for {targetText}, one per part. Choose copies and where to
            start on the sheet next.
          </Text>
          {targetItems.length ? (
            <PrintLabelsButton
              kind="item"
              ids={targetItems.slice(0, 240)}
              label={
                targetItems.length === 1
                  ? 'Print label'
                  : `Print ${targetItems.length} labels`
              }
            />
          ) : (
            <Alert color="orange">No known parts chosen.</Alert>
          )}
        </Stack>
      </Modal>
    </div>
  );
}
