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
