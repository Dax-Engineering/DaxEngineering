'use server';

import { cookies, headers } from 'next/headers';
import {
  parsePairPayload,
  PhoneScanPaired,
  PhoneScanReply,
  PhoneScanState,
} from '@dax/inventory-contract';
import { ApiError } from '@dax/web-data-access/server';
import { PHONE_COOKIE } from '../../lib/phone';
import { api } from '../../lib/server';

const base = '/inventory/phone-scans';
const NO_SESSION: PhoneScanState = {
  status: 'NONE',
  expiresAt: null,
  owner: null,
  lines: 0,
};

async function phoneToken(): Promise<string | null> {
  return (await cookies()).get(PHONE_COOKIE)?.value ?? null;
}

async function isHttps(): Promise<boolean> {
  const h = await headers();
  return (
    h.get('x-forwarded-proto') === 'https' ||
    process.env['NODE_ENV'] === 'production'
  );
}

export type PairResult =
  { ok: true; state: PhoneScanState } | { ok: false; message: string };

const PAIR_MESSAGES: Record<string, string> = {
  wrong_code: 'That code did not match. Show a new code on the PC.',
  locked: 'That code is locked. Press "New code" on the PC.',
  expired: 'That code has expired. Press "New code" on the PC.',
  used: 'That code was already used by another phone. Press "New code" on the PC.',
};

/** Pairs this phone with the PC whose QR code was just scanned. */
export async function pairPhone(scanned: string): Promise<PairResult> {
  const pair = parsePairPayload(scanned);
  if (!pair) {
    return {
      ok: false,
      message: 'That is not the PC code. On the PC, open "Scan with phone".',
    };
  }
  let result: PhoneScanPaired;
  try {
    result = await api.request(
      `${base}/pair`,
      (d) => PhoneScanPaired.parse(d),
      { method: 'POST', json: pair },
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      ok: false,
      message: 'Could not reach the stores system. Try again.',
    };
  }
  if (!result.ok) {
    return { ok: false, message: PAIR_MESSAGES[result.reason] as string };
  }
  // The scan token lives only in this cookie, sent only to the /p page.
  (await cookies()).set(PHONE_COOKIE, result.phoneToken, {
    httpOnly: true,
    secure: await isHttps(),
    sameSite: 'strict',
    path: '/p',
    expires: new Date(Date.parse(result.expiresAt) + 2 * 60 * 60 * 1000),
  });
  return {
    ok: true,
    state: {
      status: 'PAIRED',
      expiresAt: result.expiresAt,
      owner: result.owner,
      lines: 0,
    },
  };
}

export async function phoneState(): Promise<PhoneScanState> {
  const token = await phoneToken();
  if (!token) return NO_SESSION;
  try {
    return await api.request(`${base}/state`, (d) => PhoneScanState.parse(d), {
      method: 'POST',
      json: { phoneToken: token },
    });
  } catch {
    return NO_SESSION;
  }
}

export async function scanFromPhone(
  code: string,
  format?: string,
): Promise<PhoneScanReply | null> {
  const token = await phoneToken();
  const trimmed = code.trim();
  if (!token) return { result: 'ended', line: null, expiresAt: null };
  if (!trimmed || trimmed.length > 512) return null;
  try {
    return await api.request(`${base}/scan`, (d) => PhoneScanReply.parse(d), {
      method: 'POST',
      json: {
        phoneToken: token,
        code: trimmed,
        ...(format && /^[a-z0-9_]{2,24}$/.test(format) ? { format } : {}),
      },
    });
  } catch {
    return null;
  }
}
