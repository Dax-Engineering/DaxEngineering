'use client';

import { Button } from '@mantine/core';
import {
  barcodeFormatLabel,
  parsePairPayload,
  type PhoneScanState,
} from '@dax/inventory-contract';
import { Icon, type ScanReply, Scanner } from '@dax/web-shell';
import { useEffect, useRef, useState } from 'react';
import { pairPhone, phoneState, scanFromPhone } from './actions';

type Tone = 'ok' | 'miss' | 'info';

interface Result {
  key: number;
  tone: Tone;
  title: string;
  sub: string;
  /** Barcode symbology, e.g. "EAN-13". */
  format: string | null;
  qty: string | null;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function left(expiresAt: string | null, now: number): string {
  if (!expiresAt) return '0:00';
  const s = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let resultKey = 0;

/** Phone photos are large; a 1600 px JPEG is plenty to read a label. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext('2d')
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, 'image/jpeg', 0.82),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

const TONE_ICON: Record<Tone, string> = {
  ok: 'check',
  miss: 'alert',
  info: 'phone',
};

function ResultCard({ result, hint }: { result: Result | null; hint: string }) {
  const tone = result?.tone ?? 'info';
  return (
    <div className="dax-ps-result" data-tone={tone} aria-live="polite">
      <span className="dax-ps-result-ico" aria-hidden>
        <Icon name={TONE_ICON[tone]} size={22} />
      </span>
      <div className="dax-ps-result-text">
        <b>{result?.title ?? 'Ready'}</b>
        <span>{result?.sub ?? hint}</span>
      </div>
      <div className="dax-ps-result-side">
        {result?.qty ? <span className="dax-ps-qty">×{result.qty}</span> : null}
        {result?.format ? (
          <span className="dax-ps-format">{result.format}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One screen for both steps, so nothing moves: first the camera reads the
 * PC's QR code to pair, then the same camera scans barcodes.
 */
export function PhoneScanner({ initial }: { initial: PhoneScanState }) {
  const [state, setState] = useState(initial);
  const [last, setLast] = useState<Result | null>(null);
  const [recent, setRecent] = useState<Result[]>([]);
  const [count, setCount] = useState(initial.lines);
  const [photoFor, setPhotoFor] = useState<{ lineId: string } | null>(null);
  const [photoState, setPhotoState] = useState<
    'idle' | 'sending' | 'sent' | 'failed'
  >('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const paired =
    state.status === 'PAIRED' &&
    state.expiresAt !== null &&
    Date.parse(state.expiresAt) > now;

  // Pick up "Add 15 min" or "End" from the PC.
  useEffect(() => {
    if (state.status !== 'PAIRED') return;
    const timer = window.setInterval(() => {
      void phoneState().then(setState);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  function show(result: Omit<Result, 'key'>, keep = true) {
    const r = { ...result, key: ++resultKey };
    setLast(r);
    if (keep) setRecent((list) => [r, ...list].slice(0, 25));
  }

  const note = (tone: Tone, title: string, sub: string) => ({
    tone,
    title,
    sub,
    format: null,
    qty: null,
  });

  async function handle(code: string, rawFormat?: string): Promise<ScanReply> {
    const format = rawFormat ? barcodeFormatLabel(rawFormat) : null;
    const pairCode = parsePairPayload(code);
    if (!paired) {
      if (!pairCode) {
        show(
          note(
            'miss',
            'Not connected yet',
            'Scan the QR code on the PC first.',
          ),
          false,
        );
        return 'miss';
      }
      const result = await pairPhone(code);
      if (!result.ok) {
        show(note('miss', 'Could not connect', result.message), false);
        return 'miss';
      }
      setState(result.state);
      setRecent([]);
      setCount(0);
      show(note('info', 'Connected', 'Now scan the parts.'), false);
      return 'ok';
    }
    // The PC's code is often still in view right after pairing: ignore it.
    if (pairCode) return;

    const reply = await scanFromPhone(code, rawFormat);
    if (!reply) {
      show({
        ...note('miss', 'Not sent', 'Check the connection and scan again.'),
        format,
      });
      return 'miss';
    }
    if (reply.expiresAt) {
      setState((s) => ({ ...s, expiresAt: reply.expiresAt }));
    }
    const qty = reply.line?.qty ?? null;
    if (reply.result === 'unknown' && reply.line) {
      setPhotoFor({ lineId: reply.line.id });
      setPhotoState('idle');
    } else if (reply.result !== 'ended') setPhotoFor(null);
    if (qty === '1') setCount((c) => c + 1);

    switch (reply.result) {
      case 'added':
        show({
          tone: 'ok',
          title: `${reply.line?.partNo ?? code}${reply.line?.brand ? ` · ${reply.line.brand}` : ''}`,
          sub: reply.line?.description ?? '',
          format,
          qty,
        });
        return 'ok';
      case 'several':
        show({
          tone: 'ok',
          title: code,
          sub: 'Matches several parts. The PC will pick one.',
          format,
          qty,
        });
        return 'ok';
      case 'unknown':
        show({
          tone: 'miss',
          title: code,
          sub: 'Not in the system yet. Sent to the PC.',
          format,
          qty,
        });
        return 'miss';
      case 'bin':
        show(
          {
            ...note('miss', 'Bin label', 'Scan the part, not the shelf.'),
            format,
          },
          false,
        );
        return 'miss';
      default:
        setState((s) => ({ ...s, status: 'ENDED' }));
        show(
          note('info', 'Session ended', 'Scan a new code on the PC.'),
          false,
        );
        return 'miss';
    }
  }

  async function sendPhoto(file: File | undefined) {
    if (!file || !photoFor) return;
    setPhotoState('sending');
    const body = new FormData();
    body.set('lineId', photoFor.lineId);
    body.set('file', await shrink(file), 'label.jpg');
    const res = await fetch('/p/photo', { method: 'POST', body }).catch(
      () => null,
    );
    const data = (await res?.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    setPhotoState(res?.ok && data?.ok ? 'sent' : 'failed');
  }

  const hint = paired
    ? 'Point the camera at a barcode. Each scan adds 1 on the PC.'
    : state.status === 'ENDED' || state.status === 'LOCKED'
      ? 'Session ended. On the PC press "New code", then scan it.'
      : 'On the PC press Scan, then Scan with External Phone, and point the camera at its QR code.';

  const ended = state.status === 'ENDED' || state.status === 'LOCKED';

  return (
    <main className="dax-ps" data-live={paired || undefined}>
      {/* Camera fills the screen behind everything */}
      <div className="dax-ps-camera">
        <Scanner
          onCode={handle}
          manualEntry={false}
          compact
          fill
          target={paired ? 'barcode' : 'qr'}
        />
      </div>

      {/* Floating status over the camera */}
      <header className="dax-ps-top">
        <span className="dax-ps-pill dax-ps-status">
          <Icon name="phone" size={15} />
          <span className="dax-ps-who">
            {paired
              ? `${state.owner ?? 'Connected'} · ${count} ${count === 1 ? 'part' : 'parts'}`
              : ended
                ? 'Session ended'
                : 'Not connected'}
          </span>
        </span>
        {paired ? (
          <span className="dax-ps-pill dax-ps-time" aria-label="Time left">
            <Icon name="history" size={15} />
            {left(state.expiresAt, now)}
          </span>
        ) : null}
      </header>

      <p className="dax-ps-aim" aria-hidden>
        {paired ? 'Aim at a barcode' : 'Aim at the QR code on the PC'}
      </p>

      {/* Bottom sheet: last result, photo, recent scans */}
      <section className="dax-ps-sheet" aria-label="Scans">
        <span className="dax-ps-grip" aria-hidden />

        {paired ? (
          <>
            <ResultCard result={last} hint={hint} />
            <div className="dax-ps-action">
              {photoFor ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => {
                      void sendPhoto(e.currentTarget.files?.[0]);
                      e.currentTarget.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    radius="xl"
                    variant={photoState === 'sent' ? 'light' : 'filled'}
                    leftSection={<Icon name="camera" size={16} />}
                    loading={photoState === 'sending'}
                    onClick={() => fileRef.current?.click()}
                  >
                    {photoState === 'sent'
                      ? 'Photo sent'
                      : 'Photo of the label'}
                  </Button>
                  {photoState === 'failed' ? (
                    <span>Could not send. Try again.</span>
                  ) : null}
                </>
              ) : (
                <span>Each scan adds 1 on the PC.</span>
              )}
            </div>
            <div className="dax-ps-recent">
              <h2>Last scans</h2>
              {recent.length === 0 ? (
                <p className="dax-ps-empty">Nothing scanned yet.</p>
              ) : (
                <ol>
                  {recent.map((r) => (
                    <li key={r.key} data-tone={r.tone}>
                      <Icon name={TONE_ICON[r.tone]} size={16} />
                      <span className="t">{r.title}</span>
                      {r.format ? <span className="f">{r.format}</span> : null}
                      {r.qty ? <span className="q">×{r.qty}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        ) : (
          <div className="dax-ps-pair">
            <h1>{ended ? 'Scan a new code' : 'Connect to the PC'}</h1>
            {last && last.tone === 'miss' ? (
              <p className="dax-ps-pair-error">{last.sub}</p>
            ) : null}
            <ol>
              <li>
                <span>1</span>
                <div>
                  <b>On the PC</b>
                  <small>
                    Open Stores, press <em>Scan</em>, then{' '}
                    <em>Scan with External Phone</em>
                    {ended ? ', then New code' : ''}.
                  </small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <b>Point this camera at the QR code</b>
                  <small>It connects straight away, no sign-in.</small>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <b>Scan the parts</b>
                  <small>Each scan adds 1 to the list on the PC.</small>
                </div>
              </li>
            </ol>
          </div>
        )}
      </section>
    </main>
  );
}
