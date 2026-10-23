// Business-timezone helpers: conversions for Asia/Kathmandu (UTC+05:45, a
// non-whole-hour offset), midnight boundaries, and results that don't depend
// on the server's own TZ.
import { execFileSync } from 'child_process';
import path from 'path';
import {
  businessClock,
  businessToday,
  endOfBusinessDay,
  formatInBusinessTz,
  hasSlotStarted,
  periodKey,
  startOfBusinessDay,
  toUtcFromBusinessLocal,
} from '../utils/businessTime';

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
});

describe('Kathmandu conversions (UTC+05:45)', () => {
  it('turns a local date and time into the right UTC instant', () => {
    expect(toUtcFromBusinessLocal('2026-10-23', '14:00').toISOString()).toBe('2026-10-23T08:15:00.000Z');
    expect(toUtcFromBusinessLocal('2026-10-23', '07:00').toISOString()).toBe('2026-10-23T01:15:00.000Z');
  });

  it('formats an instant back in local time', () => {
    const instant = new Date('2026-10-23T08:15:00.000Z');
    expect(formatInBusinessTz(instant, { hour: 'numeric', minute: '2-digit', hour12: true }, 'en-US')).toBe('2:00 PM');
    expect(businessClock(instant)).toMatchObject({ date: '2026-10-23', time: '14:00' });
  });

  it('handles the local-midnight boundary that falls at 18:15 UTC', () => {
    // 18:14 UTC is still 23:59 on the 22nd locally; 18:15 UTC is midnight on the 23rd
    expect(businessToday(new Date('2026-10-22T18:14:59.000Z'))).toBe('2026-10-22');
    expect(businessToday(new Date('2026-10-22T18:15:00.000Z'))).toBe('2026-10-23');
    expect(startOfBusinessDay('2026-10-23').toISOString()).toBe('2026-10-22T18:15:00.000Z');
    expect(endOfBusinessDay('2026-10-23').toISOString()).toBe('2026-10-23T18:14:59.999Z');
  });

  it('a 00:30 local slot belongs to the same calendar day, not the day before', () => {
    expect(toUtcFromBusinessLocal('2026-10-23', '00:30').toISOString()).toBe('2026-10-22T18:45:00.000Z');
  });

  it('groups instants by local day for reports', () => {
    // 20:00 UTC on the 22nd is 01:45 on the 23rd in Kathmandu
    expect(periodKey(new Date('2026-10-22T20:00:00.000Z'), 'day')).toBe('2026-10-23');
    // ...but a calendar date (expenseDate) is read as stored
    expect(periodKey(new Date('2026-10-22T00:00:00.000Z'), 'day', { calendar: true })).toBe('2026-10-22');
  });

  it('knows when a slot has started, with an optional grace period', () => {
    const slot = { date: '2026-10-23', startTime: '14:00' };
    expect(hasSlotStarted(slot, new Date('2026-10-23T08:14:59.000Z'))).toBe(false);
    expect(hasSlotStarted(slot, new Date('2026-10-23T08:15:00.000Z'))).toBe(true);
    // POS walk-in grace of 60 minutes: still sellable at 14:30 local
    expect(hasSlotStarted(slot, new Date('2026-10-23T08:45:00.000Z'), 60)).toBe(false);
  });
});

describe('Results do not depend on the server TZ', () => {
  const probe = `
    process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
    const t = require(${JSON.stringify(path.join(__dirname, '../utils/businessTime'))});
    console.log(JSON.stringify([
      t.toUtcFromBusinessLocal('2026-10-23', '14:00').toISOString(),
      t.startOfBusinessDay('2026-10-23').toISOString(),
      t.endOfBusinessDay('2026-12-31').toISOString(),
      t.businessToday(new Date('2026-10-22T18:15:00Z')),
      t.periodKey(new Date('2026-12-31T19:00:00Z'), 'week'),
      t.periodKey(new Date('2026-01-01T00:00:00Z'), 'month', { calendar: true }),
      t.formatCalendarDate(new Date('2026-10-23T00:00:00Z')),
      t.hasSlotStarted({ date: '2026-10-23', startTime: '14:00' }, new Date('2026-10-23T08:20:00Z')),
    ]));
  `;
  const run = (tz: string) =>
    execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', probe], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    }).trim();

  it('gives identical answers under TZ=UTC and TZ=Australia/Perth', () => {
    const utc = run('UTC');
    const perth = run('Australia/Perth');
    expect(perth).toBe(utc);
    expect(JSON.parse(utc)[0]).toBe('2026-10-23T08:15:00.000Z');
  }, 30_000);
});
