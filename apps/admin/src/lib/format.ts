import type { AdminUser } from '@dax/platform-contract';
import type { PillTone } from '@dax/web-shell';

type Scope = 'OWN' | 'DEPARTMENT' | 'ALL';
type Tier = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export const SCOPE_LABELS: Record<Scope, string> = {
  OWN: 'Own',
  DEPARTMENT: 'Department',
  ALL: 'All',
};

export const TIER_LABELS: Record<Tier, string> = {
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  RESTRICTED: 'Restricted',
};

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** 23/11/2026, 11:53 AM in Colombo time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : dateTime.format(d).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateOnly.format(d);
}

export type UserStatus = 'Active' | 'Invited' | 'Locked' | 'Deactivated';

export function userStatus(
  user: Pick<AdminUser, 'active' | 'lockedUntil' | 'hasPassword'>,
): UserStatus {
  if (!user.active) return 'Deactivated';
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date())
    return 'Locked';
  if (!user.hasPassword) return 'Invited';
  return 'Active';
}

export const STATUS_TONES: Record<UserStatus, PillTone | undefined> = {
  Active: 'ok',
  Invited: 'hi',
  Locked: 'bad',
  Deactivated: undefined,
};

export const TIER_TONES: Record<Tier, PillTone | undefined> = {
  INTERNAL: undefined,
  CONFIDENTIAL: 'hi',
  RESTRICTED: 'bad',
};

export function humanizeAction(action: string): string {
  const words = action.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
