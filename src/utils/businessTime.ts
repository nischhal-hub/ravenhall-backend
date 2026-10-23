// Time helpers for the business's local timezone.
//
// Slots are stored as a calendar day (`TimeSlot.date`, a Postgres DATE that Prisma
// returns as UTC midnight) plus wall-clock "HH:mm" strings. Those wall-clock times
// are local to the centre, so the real start instant depends on the timezone.
// Everything is computed and compared in UTC; the timezone is only used to turn
// a local wall time into an instant and to format times for people.

export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Kathmandu';

export function businessTimeZone() {
  return process.env.BUSINESS_TIMEZONE || DEFAULT_BUSINESS_TIMEZONE;
}

/** Calendar parts of `instant` as seen on a wall clock in `timeZone`. */
function wallClockParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at `instant` (e.g. +5:45 → 20_700_000). */
function zoneOffsetMs(instant: Date, timeZone: string) {
  const p = wallClockParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time on a slot's calendar day.
 * `slotDate` is the DATE column (UTC midnight); `time` is "HH:mm".
 */
export function slotStartInstant(slotDate: Date, time: string, timeZone = businessTimeZone()) {
  const [hour, minute] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(
    slotDate.getUTCFullYear(),
    slotDate.getUTCMonth(),
    slotDate.getUTCDate(),
    hour,
    minute,
  );
  // Guess with the offset at the naive instant, then correct once in case the
  // guess landed on the other side of a DST change.
  const guess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  return new Date(wallAsUtc - zoneOffsetMs(new Date(guess), timeZone));
}

/** The local calendar day of `instant`, as a UTC-midnight Date matching the DATE column. */
export function businessDate(instant: Date, timeZone = businessTimeZone()) {
  const p = wallClockParts(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/** "2:00 PM" in the business timezone */
export function formatBusinessTime(instant: Date, timeZone = businessTimeZone()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
}

/** "Fri, 23 Oct 2026" in the business timezone */
export function formatBusinessDate(instant: Date, timeZone = businessTimeZone()) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

// ── Single source of truth for business-local dates and times ───────────────
// Everything that interprets a picked date/time, decides what "today" is, or
// formats a time for people goes through these helpers. Results never depend
// on the server's own TZ: only `Date.UTC`, `getUTC*` and `Intl` with an
// explicit timeZone are used.

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" (or a DATE-column Date) → UTC-midnight Date for that calendar day */
export function parseCalendarDate(date: string | Date): Date {
  if (date instanceof Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  const m = YMD.exec(date.slice(0, 10));
  if (!m) throw new Error(`Invalid calendar date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** UTC instant of a wall-clock time ("HH:mm") on a business-local calendar day */
export function toUtcFromBusinessLocal(date: string | Date, time: string, timeZone = businessTimeZone()) {
  return slotStartInstant(parseCalendarDate(date), time, timeZone);
}

/** UTC instant when the business-local calendar day begins (00:00 local) */
export function startOfBusinessDay(date: string | Date, timeZone = businessTimeZone()) {
  return toUtcFromBusinessLocal(date, '00:00', timeZone);
}

/** Last millisecond of the business-local calendar day */
export function endOfBusinessDay(date: string | Date, timeZone = businessTimeZone()) {
  const next = parseCalendarDate(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Date(startOfBusinessDay(next, timeZone).getTime() - 1);
}

/** Business-local calendar date ("YYYY-MM-DD") and clock time ("HH:mm") of an instant */
export function businessClock(instant = new Date(), timeZone = businessTimeZone()) {
  const p = wallClockParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    year: p.year,
    month: p.month,
    day: p.day,
  };
}

/** Today's business-local calendar date as "YYYY-MM-DD" */
export function businessToday(now = new Date(), timeZone = businessTimeZone()) {
  return businessClock(now, timeZone).date;
}

/** Format an instant in the business timezone with any Intl options */
export function formatInBusinessTz(
  instant: Date,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-AU',
  timeZone = businessTimeZone(),
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(instant);
}

/** Format a DATE-column value (a calendar day, no time) without shifting it */
export function formatCalendarDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  locale = 'en-AU',
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(parseCalendarDate(date));
}

/**
 * True once a slot's start (plus an optional grace) has been reached.
 * `graceMinutes` lets POS sell the hour that is already under way to walk-ins.
 */
export function hasSlotStarted(
  slot: { date: Date | string; startTime: string },
  now = new Date(),
  graceMinutes = 0,
) {
  const startsAt = toUtcFromBusinessLocal(slot.date, slot.startTime);
  return now.getTime() >= startsAt.getTime() + graceMinutes * 60_000;
}

/**
 * Chart/report grouping key ("2026", "2026-10", "2026-W43", "2026-10-23").
 * Instants are grouped by their business-local day; pass `calendar: true` for
 * DATE-style values (e.g. expenseDate) so they're read as stored.
 */
export function periodKey(
  date: Date,
  interval: string,
  { calendar = false, padWeek = true }: { calendar?: boolean; padWeek?: boolean } = {},
) {
  const { year, month, day } = calendar
    ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
    : businessClock(date);
  const pad = (n: number) => String(n).padStart(2, '0');

  if (interval === 'year') return `${year}`;
  if (interval === 'month') return `${year}-${pad(month)}`;
  if (interval === 'week') {
    const dayMs = 24 * 60 * 60 * 1000;
    const firstJan = Date.UTC(year, 0, 1);
    const days = Math.floor((Date.UTC(year, month - 1, day) - firstJan) / dayMs);
    const week = Math.ceil((days + new Date(firstJan).getUTCDay() + 1) / 7);
    return `${year}-W${padWeek ? pad(week) : week}`;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** UTC instant when the business-local month containing `instant` (shifted by `monthOffset`) begins */
export function startOfBusinessMonth(instant = new Date(), monthOffset = 0) {
  const { year, month } = businessClock(instant);
  const first = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return startOfBusinessDay(first);
}

/** "today", "tomorrow" or "on Fri, 23 Oct 2026", relative to `now` in the business timezone */
export function relativeBusinessDay(instant: Date, now: Date, timeZone = businessTimeZone()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(
    (businessDate(instant, timeZone).getTime() - businessDate(now, timeZone).getTime()) / dayMs,
  );
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `on ${formatBusinessDate(instant, timeZone)}`;
}
