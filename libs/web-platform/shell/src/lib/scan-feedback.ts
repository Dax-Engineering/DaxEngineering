'use client';

/** What a screen tells the scanner after it looked a code up. */
export type ScanTone = 'ok' | 'miss';

const MUTE_KEY = 'dax.scan.muted';
const listeners = new Set<() => void>();

export function isScanMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setScanMuted(muted: boolean): void {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, '1');
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // Not remembered on this device; the toggle still works for this page.
  }
  listeners.forEach((l) => l());
}

export function subscribeScanMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let audio: AudioContext | null = null;

/**
 * Phones only allow sound after a tap, so the audio context is created (or
 * resumed) on the first touch anywhere on a page with a scanner.
 */
export function unlockScanAudio(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function beep(frequency: number, start: number, length: number) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  const t = audio.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** Beep and buzz for a scan result: one high beep for a hit, two low for a miss. */
export function playScanFeedback(tone: ScanTone): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(tone === 'ok' ? 40 : [90, 60, 90]);
  }
  if (isScanMuted()) return;
  unlockScanAudio();
  if (tone === 'ok') beep(1760, 0, 0.09);
  else {
    beep(330, 0, 0.14);
    beep(260, 0.18, 0.18);
  }
}
