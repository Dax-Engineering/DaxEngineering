'use client';

import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  SegmentedControl,
} from '@mantine/core';
import {
  barcodeFormatLabel,
  CODE_KIND_LABELS,
  pairPayload,
  type PhoneScanLineDto,
  type PhoneScanStart,
  type PhoneScanView,
} from '@dax/inventory-contract';
import {
  Empty,
  Icon,
  Mono,
  QrBox,
  type ScanReply,
  Scanner,
} from '@dax/web-shell';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatQty } from '../../../../lib/format';
import {
  endPhoneScan,
  extendPhoneScan,
  getPhoneScan,
  type PhoneResult,
  removePhoneScanLine,
  scanOnPc,
  setPhoneScanQty,
  startPhoneScan,
} from './actions';
import { LineDetails } from './line-details';
import { UseList, type UseListAccess, type UseRequest } from './use-list';

// The pairing code lives only in this browser tab: the server shows it once
// and never stores it unhashed.
const KEY = 'dax.phone-scan';
const POLL_MS = 2000;
// Byte-order mark, so Excel opens the CSV as UTF-8.
const BOM = String.fromCharCode(0xfeff);

function remember(start: PhoneScanStart | null) {
  try {
    if (start) window.sessionStorage.setItem(KEY, JSON.stringify(start));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered; reloading the page just makes a new code.
  }
}

function recall(): PhoneScanStart | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PhoneScanStart) : null;
  } catch {
    return null;
  }
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

function left(expiresAt: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ago(at: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

const open = (v: PhoneScanView | null) =>
  v?.status === 'WAITING' || v?.status === 'PAIRED';

function csv(lines: PhoneScanLineDto[]): string {
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const rows = lines.map((l) =>
    [
      l.item?.partNo ?? '',
      l.item?.brand ?? '',
      l.item?.description ?? '',
      l.code,
      barcodeFormatLabel(l.format),
      l.qty,
      l.item?.uom ?? '',
      l.stock?.onHand ?? '',
    ]
      .map(cell)
      .join(','),
  );
  return [
    '"Part number","Brand","Description","Scanned code","Barcode type","Qty","Unit","On hand"',
    ...rows,
  ].join('\r\n');
}

type Filter = 'all' | 'known' | 'todo';

function LineCard({
  line,
  now,
  busy,
  onQty,
  onOpen,
  onRemove,
  selected,
  onSelect,
}: {
  line: PhoneScanLineDto;
  now: number;
  busy: boolean;
  onQty: (qty: string) => void;
  onOpen: () => void;
  onRemove: () => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  const n = Number(line.qty);
  const known = line.item !== null;
  const label = line.item?.partNo ?? line.code;
  return (
    <article
      className="dax-pp-line"
      data-known={known || undefined}
      data-selected={selected || undefined}
    >
      <div className="dax-pp-line-pick">
        <Checkbox
          aria-label={`Select ${label}`}
          checked={selected}
          onChange={(e) => onSelect(e.currentTarget.checked)}
        />
        <span className="dax-pp-line-ico" aria-hidden>
          <Icon name={known ? 'check' : 'alert'} size={20} />
        </span>
      </div>
      <div className="dax-pp-line-main">
        {line.item ? (
          <div className="dax-pp-line-title">
            <Mono>{line.item.partNo}</Mono>
            <span className="dax-pp-brand">{line.item.brand}</span>
          </div>
        ) : (
          <div className="dax-pp-line-title">
            <span>
              {line.matches > 1
                ? `Matches ${line.matches} items`
                : 'Not in the system'}
            </span>
          </div>
        )}
        <div className="dax-pp-line-desc">
          {line.item?.description ?? 'Add it as a new item, or link it to one.'}
        </div>
        <div className="dax-pp-tags">
          <span className="dax-pp-tag strong">
            <Icon name="barcode" size={14} />
            {barcodeFormatLabel(line.format)}
          </span>
          <span className="dax-pp-tag">{CODE_KIND_LABELS[line.kind]}</span>
          <span className="dax-pp-tag code">
            <Mono>{line.code}</Mono>
          </span>
          {line.gtin &&
          line.gtin.replace(/^0+/, '') !== line.code.replace(/^0+/, '') ? (
            <span className="dax-pp-tag">GTIN {line.gtin}</span>
          ) : null}
          {line.photoId ? (
            <a
              className="dax-pp-tag link"
              href={`/files/${line.photoId}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="camera" size={14} />
              Photo
            </a>
          ) : null}
        </div>
      </div>
      <div className="dax-pp-line-stock">
        {line.stock ? (
          <>
            <span>
              <b>{formatQty(line.stock.onHand)}</b> on hand
            </span>
            <span>
              <b>{formatQty(line.stock.free)}</b> free
            </span>
            <span>
              {line.stock.bins} {line.stock.bins === 1 ? 'bin' : 'bins'}
            </span>
          </>
        ) : (
          <span className="dax-muted">No stock yet</span>
        )}
        <span className="dax-pp-ago">{ago(line.lastSeenAt, now)}</span>
      </div>
      <div className="dax-pp-line-side">
        <div className="dax-pp-stepper" aria-label="Quantity">
          <button
            type="button"
            disabled={busy || n <= 1}
            onClick={() => onQty(String(Math.max(1, n - 1)))}
            aria-label="One less"
          >
            <Icon name="minus" size={16} />
          </button>
          <span>
            {formatQty(line.qty)}
            <small>{line.item?.uom ?? ''}</small>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onQty(String(n + 1))}
            aria-label="One more"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        <Group gap={6} wrap="nowrap">
          <Button
            size="xs"
            radius="xl"
            variant={known ? 'default' : 'filled'}
            color={known ? undefined : 'ember'}
            onClick={onOpen}
          >
            {known ? 'Details' : 'Add or link'}
          </Button>
          <button
            type="button"
            className="dax-pp-remove"
            disabled={busy}
            onClick={onRemove}
            aria-label={`Remove ${label}`}
          >
            <Icon name="close" size={16} />
          </button>
        </Group>
      </div>
    </article>
  );
}

/** Scan into the same list with this PC's own camera. */
function PcCamera({
  onCode,
}: {
  onCode: (code: string, format?: string) => Promise<ScanReply>;
}) {
  const [on, setOn] = useState(false);
  if (!on) {
    return (
      <Button
        size="xs"
        radius="xl"
        variant="light"
        leftSection={<Icon name="camera" size={14} />}
        onClick={() => setOn(true)}
      >
        Scan with this PC&apos;s camera
      </Button>
    );
  }
  return (
    <div className="dax-pp-pc-cam">
      <Scanner onCode={onCode} compact manualEntry={false} />
      <Button
        size="xs"
        radius="xl"
        variant="default"
        onClick={() => setOn(false)}
      >
        Close camera
      </Button>
    </div>
  );
}

export function PhonePanel({
  origin,
  access,
  departments,
}: {
  origin: string | null;
  access: UseListAccess;
  departments: { id: string; name: string }[];
}) {
  const [link, setLink] = useState<PhoneScanStart | null>(null);
  const [view, setView] = useState<PhoneScanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'list' | 'url' | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [useRequest, setUseRequest] = useState<UseRequest | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const now = useNow();

  const apply = useCallback(
    <T,>(result: PhoneResult<T>, then: (d: T) => void) => {
      if (result.ok) {
        setError(null);
        then(result.data);
      } else setError(result.message);
    },
    [],
  );

  const startNew = useCallback(async () => {
    setBusy(true);
    const started = await startPhoneScan();
    setBusy(false);
    apply(started, (data) => {
      remember(data);
      setLink(data);
      setView(null);
    });
    if (started.ok) {
      const first = await getPhoneScan(started.data.id);
      apply(first, setView);
    }
  }, [apply]);

  // Reuse this tab's code after a reload, otherwise make a new one.
  useEffect(() => {
    const saved = recall();
    if (!saved) {
      void startNew();
      return;
    }
    void getPhoneScan(saved.id).then((result) => {
      if (result.ok && open(result.data)) {
        setLink(saved);
        setView(result.data);
      } else void startNew();
    });
  }, [startNew]);

  // Live list: ask the server every two seconds while the session is open.
  useEffect(() => {
    if (!link || !open(view)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void getPhoneScan(link.id).then((r) => {
        if (r.ok) setView(r.data);
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [link, view?.status]);

  /** Runs a change and shows the new list; returns the error, if any. */
  async function act(
    fn: () => Promise<PhoneResult<PhoneScanView>>,
  ): Promise<string | null> {
    setBusy(true);
    let result: PhoneResult<PhoneScanView>;
    try {
      result = await fn();
    } catch {
      // Never leave the buttons locked after an unexpected failure.
      result = { ok: false, message: 'That did not work. Try again.' };
    } finally {
      setBusy(false);
    }
    apply(result, setView);
    return result.ok ? null : result.message;
  }

  const lines = useMemo(() => view?.lines ?? [], [view]);
  // Ticks only ever point at lines that still exist.
  const selectedIds = lines.filter((l) => selected.has(l.id)).map((l) => l.id);

  async function removeLines(ids: string[]) {
    if (!view) return;
    for (const id of ids) {
      const failed = await act(() => removePhoneScanLine(view.id, id));
      if (failed) break;
    }
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }
  const shown = lines.filter((l) =>
    filter === 'all'
      ? true
      : filter === 'known'
        ? l.item !== null
        : l.item === null,
  );
  const totals = useMemo(() => {
    const qty = lines.reduce((sum, l) => sum + Number(l.qty), 0);
    const todo = lines.filter((l) => l.item === null).length;
    return { qty, todo, known: lines.length - todo };
  }, [lines]);
  const phoneUrl = origin ? new URL('/p', origin).toString() : null;
  const expired = view && open(view) && Date.parse(view.expiresAt) <= now;
  const status = expired ? 'ENDED' : view?.status;

  async function scanHere(code: string, format?: string): Promise<ScanReply> {
    if (!view) return 'miss';
    const reply = await scanOnPc(view.id, code, format);
    if (!reply.ok) {
      setError(reply.message);
      return 'miss';
    }
    const fresh = await getPhoneScan(view.id);
    if (fresh.ok) setView(fresh.data);
    return reply.data.line ? 'ok' : 'miss';
  }

  function copy(text: string, what: 'list' | 'url') {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  function download() {
    const blob = new Blob([BOM + csv(lines)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `phone-scan-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const statusText =
    status === 'WAITING'
      ? 'Waiting for a phone'
      : status === 'PAIRED'
        ? 'Phone connected'
        : status === 'LOCKED'
          ? 'Code locked'
          : 'Session ended';

  return (
    <div className="dax-pp">
      <section className="dax-pp-hero" data-status={status ?? 'WAITING'}>
        <div className="dax-pp-side">
          {status === 'WAITING' && link ? (
            <div className="dax-pp-qr">
              <QrBox
                value={pairPayload(link.linkToken, link.code)}
                size={148}
              />
            </div>
          ) : null}
          {view && open(view) && !expired ? (
            <PcCamera onCode={scanHere} />
          ) : null}
        </div>

        <div className="dax-pp-hero-main">
          <div className="dax-pp-status">
            <span className="dax-pp-phone" aria-hidden>
              <Icon name="phone" size={20} />
            </span>
            <h2>{view ? statusText : 'Getting a code…'}</h2>
            {view && open(view) && !expired ? (
              <span className="dax-pp-timer" aria-label="Time left">
                {left(view.expiresAt, now)}
              </span>
            ) : null}
          </div>

          {error ? <Alert color="red">{error}</Alert> : null}
          {!view ? <Loader size="sm" /> : null}

          {view && status === 'WAITING' ? (
            <ol className="dax-pp-steps">
              <li>
                <span>1</span>
                <div>
                  Open the phone scanner on the phone
                  {phoneUrl ? (
                    <button
                      type="button"
                      className="dax-pp-url"
                      onClick={() => copy(phoneUrl, 'url')}
                      title={phoneUrl}
                    >
                      <Mono>{phoneUrl}</Mono>
                      <em>{copied === 'url' ? 'Copied' : 'Copy'}</em>
                    </button>
                  ) : (
                    <small>
                      Phones need https: run <Mono>pnpm dev:phone</Mono>.
                    </small>
                  )}
                </div>
              </li>
              <li>
                <span>2</span>
                <div>Point the phone at this QR code</div>
              </li>
            </ol>
          ) : null}

          {view && status === 'PAIRED' ? (
            <div className="dax-pp-stats">
              <span>
                <b>{lines.length}</b> lines
              </span>
              <span>
                <b>{formatQty(String(totals.qty))}</b> scanned
              </span>
              <span data-warn={totals.todo > 0 || undefined}>
                <b>{totals.todo}</b> to sort out
              </span>
            </div>
          ) : null}

          {view && !open(view) ? (
            <p className="dax-pp-note">
              {view.status === 'LOCKED'
                ? 'This code was locked after too many failed tries.'
                : 'The session has ended.'}{' '}
              Make a new code to scan again.
            </p>
          ) : null}

          {view ? (
            <Group gap="xs" mt={4}>
              {open(view) && !expired ? (
                <>
                  <Button
                    size="xs"
                    radius="xl"
                    variant="light"
                    disabled={busy || !view.canExtend}
                    leftSection={<Icon name="plus" size={14} />}
                    onClick={() => void act(() => extendPhoneScan(view.id))}
                  >
                    15 min
                  </Button>
                  <Button
                    size="xs"
                    radius="xl"
                    variant="default"
                    disabled={busy}
                    onClick={() => void act(() => endPhoneScan(view.id))}
                  >
                    End
                  </Button>
                </>
              ) : null}
              <Button
                size="xs"
                radius="xl"
                variant={open(view) && !expired ? 'subtle' : 'filled'}
                disabled={busy}
                onClick={() => void startNew()}
              >
                New code
              </Button>
            </Group>
          ) : null}
        </div>
      </section>

      <section className="dax-pp-list">
        {error ? (
          <Alert color="red" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {view ? (
          <UseList
            sessionId={view.id}
            lines={lines}
            selected={selectedIds}
            departments={departments}
            access={access}
            request={useRequest}
            onRequest={setUseRequest}
            onClear={() => setSelected(new Set())}
            onRemove={(ids) => void removeLines(ids)}
          />
        ) : null}
        <header className="dax-pp-list-head">
          <div className="dax-pp-list-title">
            {shown.length ? (
              <Checkbox
                aria-label="Select all shown"
                checked={shown.every((l) => selected.has(l.id))}
                indeterminate={
                  shown.some((l) => selected.has(l.id)) &&
                  !shown.every((l) => selected.has(l.id))
                }
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setSelected((s) => {
                    const next = new Set(s);
                    shown.forEach((l) =>
                      on ? next.add(l.id) : next.delete(l.id),
                    );
                    return next;
                  });
                }}
              />
            ) : null}
            <div>
              <h2>Scanned items</h2>
              <span className="dax-muted">
                {lines.length} {lines.length === 1 ? 'line' : 'lines'} ·{' '}
                {totals.known} in the system · {totals.todo} to sort out
              </span>
            </div>
          </div>
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              data={[
                { value: 'all', label: 'All' },
                { value: 'known', label: 'In the system' },
                {
                  value: 'todo',
                  label: `Needs action${totals.todo ? ` (${totals.todo})` : ''}`,
                },
              ]}
            />
            {lines.length ? (
              <>
                <Button
                  size="xs"
                  radius="xl"
                  variant="light"
                  onClick={() =>
                    copy(
                      lines
                        .map(
                          (l) =>
                            `${l.item?.partNo ?? l.code}\t${l.item?.description ?? 'Not in the system'}\t${l.qty}`,
                        )
                        .join('\n'),
                      'list',
                    )
                  }
                >
                  {copied === 'list' ? 'Copied' : 'Copy list'}
                </Button>
                <Button
                  size="xs"
                  radius="xl"
                  variant="default"
                  leftSection={<Icon name="download" size={14} />}
                  onClick={download}
                >
                  CSV
                </Button>
              </>
            ) : null}
          </Group>
        </header>

        {shown.length === 0 ? (
          <div className="dax-pp-empty">
            <Empty
              title={
                lines.length ? 'Nothing in this view' : 'Nothing scanned yet'
              }
            >
              {lines.length
                ? 'Try another filter.'
                : 'Scans from the phone appear here as they happen, with the barcode type and stock.'}
            </Empty>
          </div>
        ) : (
          <div className="dax-pp-lines">
            {shown.map((line) => (
              <LineCard
                key={line.id}
                line={line}
                now={now}
                busy={busy}
                onQty={(qty) =>
                  void act(() => setPhoneScanQty(view?.id ?? '', line.id, qty))
                }
                onOpen={() => setOpenLine(line.id)}
                onRemove={() => void removeLines([line.id])}
                selected={selected.has(line.id)}
                onSelect={(on) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (on) next.add(line.id);
                    else next.delete(line.id);
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      {view ? (
        <LineDetails
          sessionId={view.id}
          line={lines.find((l) => l.id === openLine) ?? null}
          onClose={() => setOpenLine(null)}
          act={act}
        />
      ) : null}
    </div>
  );
}
