import { describe, expect, it } from 'vitest';
import { lastReportSlot, reportDue } from './schedule';

// 2026-11-18 is a Wednesday; 10:00 in Colombo is 04:30 UTC.
const WED_10_LOCAL = new Date('2026-11-18T04:30:00.000Z');

describe('lastReportSlot', () => {
  it('finds this week’s slot once it has passed', () => {
    expect(lastReportSlot(1, '08:00', WED_10_LOCAL).toISOString()).toBe(
      '2026-11-16T02:30:00.000Z',
    );
    expect(lastReportSlot(3, '09:59', WED_10_LOCAL).toISOString()).toBe(
      '2026-11-18T04:29:00.000Z',
    );
  });

  it('goes back a week when today’s time is still ahead', () => {
    expect(lastReportSlot(3, '10:01', WED_10_LOCAL).toISOString()).toBe(
      '2026-11-11T04:31:00.000Z',
    );
  });

  it('uses the Colombo day, not the UTC day', () => {
    // 23:00 UTC Tuesday is 04:30 Wednesday in Colombo.
    const late = new Date('2026-11-17T23:00:00.000Z');
    expect(lastReportSlot(3, '04:00', late).toISOString()).toBe(
      '2026-11-17T22:30:00.000Z',
    );
  });
});

describe('reportDue', () => {
  const base = { reportWeekday: 1, reportTime: '08:00' };

  it('is due when a slot passed after the last report', () => {
    expect(
      reportDue(
        {
          ...base,
          lastReportAt: new Date('2026-11-09T03:00:00.000Z'),
          updatedAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        WED_10_LOCAL,
      ),
    ).toBe(true);
  });

  it('is not due twice for the same slot', () => {
    expect(
      reportDue(
        {
          ...base,
          lastReportAt: new Date('2026-11-16T02:35:00.000Z'),
          updatedAt: new Date('2026-11-16T02:35:00.000Z'),
        },
        WED_10_LOCAL,
      ),
    ).toBe(false);
  });

  it('waits for the next slot after the settings change', () => {
    expect(
      reportDue(
        {
          ...base,
          lastReportAt: null,
          updatedAt: new Date('2026-11-17T00:00:00.000Z'),
        },
        WED_10_LOCAL,
      ),
    ).toBe(false);
  });
});
