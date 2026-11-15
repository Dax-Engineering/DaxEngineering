'use client';

import { Box, Button, Group, Loader, Stack, TextInput } from '@mantine/core';
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BarcodeFormat } from 'barcode-detector/ponyfill';
import {
  isScanMuted,
  playScanFeedback,
  type ScanTone,
  setScanMuted,
  subscribeScanMuted,
  unlockScanAudio,
} from './scan-feedback';
import { Icon } from './icon';

export type ScannerStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'denied'
  | 'no-camera'
  | 'insecure'
  | 'unsupported'
  | 'error';

interface Detector {
  detect(
    source: HTMLVideoElement,
  ): Promise<{ rawValue: string; format?: string }[]>;
}
type CreateDetector = () => Detector;

interface NativeDetectorClass {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

const WANTED_FORMATS: BarcodeFormat[] = [
  'qr_code',
  'code_128',
  'code_39',
  'code_93',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'data_matrix',
];

// A code held in view is read once. It counts again only after it has been
// out of view this long, so "+1 per scan" works by moving the part away and
// back, without a held part counting on every frame.
const GONE_MS = 900;
const FRAME_MS = 200;

let ponyfill: Promise<CreateDetector> | null = null;

function loadPonyfill(wasmBase: string): Promise<CreateDetector> {
  ponyfill ??= import('barcode-detector/ponyfill').then(async (m) => {
    await m.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm')
            ? `${wasmBase}/${m.ZXING_WASM_VERSION}/${path}`
            : prefix + path,
      },
      fireImmediately: true,
    });
    return () => new m.BarcodeDetector({ formats: WANTED_FORMATS });
  });
  ponyfill.catch(() => {
    ponyfill = null;
  });
  return ponyfill;
}

async function loadDetector(wasmBase: string): Promise<CreateDetector> {
  const native = (globalThis as { BarcodeDetector?: NativeDetectorClass })
    .BarcodeDetector;
  if (native?.getSupportedFormats) {
    const supported: string[] = await native
      .getSupportedFormats()
      .catch(() => []);
    if (supported.includes('qr_code')) {
      const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
      return () => new native({ formats });
    }
  }
  return loadPonyfill(wasmBase);
}

function statusFromError(error: unknown): ScannerStatus {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'no-camera';
  return 'error';
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function torchSupported(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  const caps: TorchCapabilities = track.getCapabilities();
  return caps.torch === true;
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );
}

export interface UseScannerOptions {
  enabled: boolean;
  /** `format` is the symbology, e.g. ean_13, code_128, qr_code. */
  onDetect: (code: string, format?: string) => void;
  /** Same-origin folder holding `<version>/zxing_reader.wasm`. */
  wasmBase?: string;
}

export interface UseScanner {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  torch: { supported: boolean; on: boolean };
  toggleTorch: () => Promise<void>;
  restart: () => void;
}

export function useScanner({
  enabled,
  onDetect,
  wasmBase = '/zxing',
}: UseScannerOptions): UseScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDetectRef = useRef(onDetect);
  const seenRef = useRef(new Map<string, number>());
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [attempt, setAttempt] = useState(0);
  const visible = usePageVisible();
  const running = enabled && visible;

  useEffect(() => {
    onDetectRef.current = onDetect;
  });

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;

    function report(found: { rawValue: string; format?: string }[]) {
      const now = Date.now();
      const seen = seenRef.current;
      for (const hit of found) {
        const code = hit.rawValue.trim();
        if (!code) continue;
        const before = seen.get(code);
        seen.set(code, now);
        if (before === undefined || now - before > GONE_MS) {
          onDetectRef.current(code, hit.format);
        }
      }
      for (const [code, at] of seen) if (now - at > 10_000) seen.delete(code);
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('insecure');
        return;
      }
      setStatus('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (error) {
        if (!cancelled) setStatus(statusFromError(error));
        return;
      }
      if (cancelled) return stopStream(stream);
      streamRef.current = stream;

      let createDetector: CreateDetector;
      try {
        createDetector = await loadDetector(wasmBase);
      } catch {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      const video = videoRef.current;
      if (cancelled || !video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        if (!cancelled) setStatus('error');
        return;
      }
      if (cancelled) return;
      setTorch({
        supported: torchSupported(stream.getVideoTracks()[0]),
        on: false,
      });
      setStatus('scanning');

      const detector = createDetector();
      const tick = async () => {
        if (cancelled) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const found = await detector.detect(video);
            report(found);
          } catch {
            // A frame can fail to decode while the camera adjusts.
          }
        }
        if (!cancelled) timer = window.setTimeout(tick, FRAME_MS);
      };
      void tick();
    }

    void start();
    const video = videoRef.current;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (stream) stopStream(stream);
      streamRef.current = null;
      if (video) video.srcObject = null;
      setStatus('idle');
      setTorch({ supported: false, on: false });
    };
  }, [running, wasmBase, attempt]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    const advanced: TorchConstraintSet[] = [{ torch: on }];
    try {
      await track.applyConstraints({ advanced });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  return {
    videoRef,
    status,
    torch,
    toggleTorch,
    restart: () => setAttempt((n) => n + 1),
  };
}

const STATUS_MESSAGES: Partial<Record<ScannerStatus, string>> = {
  denied:
    'Camera access is blocked. Allow the camera for this site in your browser settings, then tap Try again.',
  'no-camera':
    'No camera was found. Type the code below or use a hand-held scanner.',
  insecure:
    'The camera only works on a secure (https) connection. Type the code below instead.',
  unsupported:
    "This browser can't read codes from the camera. Type the code below instead.",
  error:
    'The camera could not start. Close other apps that use it and try again.',
};

/** What a screen's scan handler returns: the tone to play, or nothing. */
export type ScanReply = ScanTone | void;

function useScanMuted(): boolean {
  return useSyncExternalStore(subscribeScanMuted, isScanMuted, () => false);
}

export function Scanner({
  onCode,
  busy = false,
  autoStart = true,
  manualEntry = true,
  compact = false,
  fill = false,
  target = 'any',
  wasmBase,
}: {
  /**
   * Called once per scan. Return (or resolve to) 'ok' or 'miss' to beep and
   * flash. Scans that arrive while one is still being handled wait their turn.
   */
  onCode: (code: string, format?: string) => ScanReply | Promise<ScanReply>;
  busy?: boolean;
  autoStart?: boolean;
  /** Show the "type or scan a code" box (for hand-held scanners). */
  manualEntry?: boolean;
  /** Small round buttons on the camera instead of a row of big ones. */
  compact?: boolean;
  /** Fill the parent (full-screen camera) instead of a 4:3 box. */
  fill?: boolean;
  /**
   * Shapes the aiming frame: a square for QR codes, a wide strip with a laser
   * for barcodes, or a box that fits both.
   */
  target?: 'any' | 'qr' | 'barcode';
  wasmBase?: string;
}) {
  const [cameraOn, setCameraOn] = useState(autoStart);
  const [manual, setManual] = useState('');
  const [working, setWorking] = useState(false);
  const [flash, setFlash] = useState<{ tone: ScanTone; key: number } | null>(
    null,
  );
  const muted = useScanMuted();
  const inputRef = useRef<HTMLInputElement>(null);
  const onCodeRef = useRef(onCode);
  const queue = useRef<{ code: string; format?: string }[]>([]);
  const draining = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 450);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // One scan at a time, in the order they were read.
  async function drain() {
    if (draining.current) return;
    draining.current = true;
    setWorking(true);
    try {
      while (alive.current && queue.current.length > 0) {
        const next = queue.current.shift() as { code: string; format?: string };
        let tone: ScanReply;
        try {
          tone = await onCodeRef.current(next.code, next.format);
        } catch {
          tone = 'miss';
        }
        if (!alive.current) return;
        if (tone) {
          playScanFeedback(tone);
          setFlash({ tone, key: Date.now() });
        }
      }
    } finally {
      draining.current = false;
      if (alive.current) setWorking(false);
    }
  }

  function enqueue(code: string, format?: string) {
    if (queue.current.length >= 20) return;
    queue.current.push({ code, format });
    void drain();
  }

  const { videoRef, status, torch, toggleTorch, restart } = useScanner({
    enabled: cameraOn,
    onDetect: enqueue,
    wasmBase,
  });
  const failed = Boolean(STATUS_MESSAGES[status]);
  const spinning = busy || working;

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = manual.trim();
    if (!code) return;
    enqueue(code, 'typed');
    setManual('');
  }

  // The camera box keeps its size whatever happens (starting, blocked, off),
  // so nothing below it jumps; problems show inside the box.
  const notice = !cameraOn
    ? 'Camera is off.'
    : failed
      ? STATUS_MESSAGES[status]
      : null;
  return (
    <Stack
      gap="md"
      onPointerDown={unlockScanAudio}
      className={fill ? 'dax-scan-fill' : undefined}
    >
      <Box className="dax-scan-box" pos="relative" bg="black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera view"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            visibility: notice ? 'hidden' : 'visible',
          }}
        />
        {notice ? (
          <div className="dax-scan-notice" role="status">
            {notice}
          </div>
        ) : (
          <div
            key={target}
            aria-hidden
            className="dax-scan-frame"
            data-target={target}
            data-flash={flash?.tone}
          >
            <span className="dax-scan-laser" />
            <span key={flash?.key ?? 0} className="dax-scan-hit" />
          </div>
        )}
        {!notice && (status === 'starting' || spinning) ? (
          <Loader
            color="white"
            pos="absolute"
            top="50%"
            left="50%"
            style={{ transform: 'translate(-50%, -50%)' }}
          />
        ) : null}
        {compact ? (
          <div className="dax-scan-tools">
            {cameraOn && failed ? (
              <button
                type="button"
                onClick={restart}
                aria-label="Try the camera again"
              >
                <Icon name="history" size={20} />
              </button>
            ) : (
              <button
                type="button"
                aria-pressed={cameraOn}
                aria-label={
                  cameraOn ? 'Turn the camera off' : 'Turn the camera on'
                }
                onClick={() => setCameraOn((on) => !on)}
              >
                <Icon name="camera" size={20} />
              </button>
            )}
            {cameraOn && torch.supported ? (
              <button
                type="button"
                aria-pressed={torch.on}
                aria-label={torch.on ? 'Light off' : 'Light on'}
                onClick={() => void toggleTorch()}
              >
                <Icon name="bolt" size={20} />
              </button>
            ) : null}
            <button
              type="button"
              aria-pressed={!muted}
              aria-label={muted ? 'Sound is off' : 'Sound is on'}
              onClick={() => setScanMuted(!muted)}
            >
              <Icon name={muted ? 'mute' : 'volume'} size={20} />
            </button>
          </div>
        ) : null}
      </Box>
      {compact ? null : (
        <Group grow>
          {cameraOn && failed ? (
            <Button size="lg" onClick={restart}>
              Try again
            </Button>
          ) : (
            <Button
              size="lg"
              variant={cameraOn ? 'default' : 'filled'}
              onClick={() => setCameraOn((on) => !on)}
            >
              {cameraOn ? 'Stop camera' : 'Start camera'}
            </Button>
          )}
          {cameraOn && torch.supported ? (
            <Button
              size="lg"
              variant="default"
              onClick={() => void toggleTorch()}
            >
              {torch.on ? 'Light off' : 'Light on'}
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="default"
            aria-pressed={!muted}
            onClick={() => setScanMuted(!muted)}
          >
            {muted ? 'Sound off' : 'Sound on'}
          </Button>
        </Group>
      )}
      {manualEntry ? (
        <form onSubmit={submit}>
          <Group align="flex-end" wrap="nowrap" gap="sm">
            <TextInput
              size="lg"
              label="Type or scan a code"
              description="Hand-held scanners type here and press Enter."
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              ref={inputRef}
              value={manual}
              onChange={(e) => setManual(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              type="submit"
              size="lg"
              loading={spinning}
              disabled={!manual.trim()}
            >
              Find
            </Button>
          </Group>
        </form>
      ) : null}
      <span className="dax-sr" role="status" aria-live="polite">
        {flash ? (flash.tone === 'ok' ? 'Found' : 'Not found') : ''}
      </span>
    </Stack>
  );
}
