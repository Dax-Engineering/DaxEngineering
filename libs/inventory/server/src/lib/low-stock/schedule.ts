const DAY_MS = 86_400_000;
// Sri Lanka has kept UTC+05:30 without daylight saving since 2006.
const COLOMBO_OFFSET_MS = 330 * 60_000;

/** The latest weekly send time (Sri Lanka time) at or before `now`. */
export function lastReportSlot(weekday: number, time: string, now: Date): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const local = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  const midnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const daysBack = (local.getUTCDay() - weekday + 7) % 7;
  let slot = midnight - daysBack * DAY_MS + (hours * 60 + minutes) * 60_000;
  if (slot > local.getTime()) slot -= 7 * DAY_MS;
  return new Date(slot - COLOMBO_OFFSET_MS);
}

/**
 * Due once a send time passes that is later than both the last report and the
 * last settings change, so saving new settings never sends a report on the spot.
 */
export function reportDue(
  settings: {
    reportWeekday: number;
    reportTime: string;
    lastReportAt: Date | null;
    updatedAt: Date;
  },
  now: Date,
): boolean {
  const slot = lastReportSlot(settings.reportWeekday, settings.reportTime, now);
  const since = Math.max(
    settings.lastReportAt?.getTime() ?? 0,
    settings.updatedAt.getTime(),
  );
  return slot.getTime() > since;
}
