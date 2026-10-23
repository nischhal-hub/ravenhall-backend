import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import {
  businessDate,
  businessTimeZone,
  formatBusinessDate,
  formatBusinessTime,
  relativeBusinessDay,
  slotStartInstant,
} from "../../utils/businessTime";
import { EmailOutcome, EmailService, isGuestEmail } from "./email.service";
import { NotificationsService } from "./notifications.service";

const emailService = new EmailService();
const notificationsService = new NotificationsService();

const MINUTE = 60_000;

/** The scheduler runs every 5 minutes (see jobs/bookingReminder.job.ts). */
export const REMINDER_JOB_INTERVAL_MINUTES = 5;

/**
 * How far past the lead time a booking may start and still be picked up now.
 * A little over half the job interval, so consecutive windows overlap and a
 * slightly delayed run can't miss a booking; the dedupe keys stop duplicates.
 */
const WINDOW_TOLERANCE_MS = 3 * MINUTE;

/**
 * A FAILED reminder email is retried by later runs for this long after its first
 * attempt (about 3 retries at a 5-minute cadence), and never once the session starts.
 */
const EMAIL_RETRY_WINDOW_MS = 15 * MINUTE;

const BATCH_SIZE = 25;

export function reminderLeadMinutes() {
  const value = Number(process.env.REMINDER_LEAD_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

/** In-app and email dedupe keys. The start time is part of the key, so a
 * rescheduled booking gets a fresh reminder and the old time never fires. */
export function reminderKeys(bookingId: string, startsAt: Date) {
  const inApp = `booking-reminder:${bookingId}:${startsAt.toISOString()}`;
  return { inApp, email: `email:${inApp}` };
}

const bookingInclude = {
  user: { select: { id: true, email: true, firstName: true } },
  payment: { select: { paidAt: true } },
  items: {
    select: {
      slotId: true,
      slot: {
        select: {
          date: true,
          startTime: true,
          endTime: true,
          lane: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

type CandidateBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

type SkipReason = "started" | "not-due" | "booked-late" | "changed" | "guest";

export interface ReminderRunResult {
  checked: number;
  inAppCreated: number;
  emails: Record<EmailOutcome, number>;
  skipped: Record<SkipReason, number>;
  errors: number;
}

function sessionTimes(booking: CandidateBooking) {
  const slots = booking.items
    .map((item) => item.slot)
    .sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime),
    );
  if (slots.length === 0) return null;
  const first = slots[0];
  const last = slots[slots.length - 1];
  return {
    startsAt: slotStartInstant(first.date, first.startTime),
    endsAt: slotStartInstant(last.date, last.endTime),
    laneName: first.lane.name,
  };
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} ${h === 1 ? "hour" : "hours"}`;
  if (h === 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

/** "HH:mm" of an instant on the business wall clock, comparable with TimeSlot.startTime */
function businessHHmm(instant: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: businessTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/**
 * Narrows candidates in SQL to confirmed bookings with a slot starting in
 * (now, windowEnd] on the business wall clock. Uses the TimeSlot (date, …) index;
 * the exact checks happen in JS on the computed UTC instants.
 */
function candidateSlotFilter(now: Date, windowEnd: Date): Prisma.TimeSlotWhereInput {
  const today = businessDate(now);
  const endDay = businessDate(windowEnd);
  const from = businessHHmm(now);
  const to = businessHHmm(windowEnd);

  if (today.getTime() === endDay.getTime()) {
    return { date: today, startTime: { gt: from, lte: to } };
  }
  // Window crosses local midnight
  return {
    OR: [
      { date: today, startTime: { gt: from } },
      { date: endDay, startTime: { lte: to } },
    ],
  };
}

export class RemindersService {
  /**
   * Sends due booking reminders (in-app + email). Safe to run concurrently, on
   * several instances, or repeatedly: every write is guarded by a unique dedupe key.
   */
  async runBookingReminders(now = new Date()): Promise<ReminderRunResult> {
    const leadMs = reminderLeadMinutes() * MINUTE;
    // Catch-up: the lower bound is "now", not "now + lead − tolerance", so a run
    // that is late (server was down) still reminds every booking that hasn't
    // started yet. A booking that has already started is never reminded.
    const windowEnd = new Date(now.getTime() + leadMs + WINDOW_TOLERANCE_MS);

    const result: ReminderRunResult = {
      checked: 0,
      inAppCreated: 0,
      emails: { sent: 0, failed: 0, duplicate: 0, skipped: 0 },
      skipped: { started: 0, "not-due": 0, "booked-late": 0, changed: 0, guest: 0 },
      errors: 0,
    };

    const where: Prisma.BookingWhereInput = {
      status: "CONFIRMED",
      items: { some: { slot: candidateSlotFilter(now, windowEnd) } },
    };

    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      const confirmedAt = await this.confirmationTimes(batch.map((b) => b.id));

      for (const booking of batch) {
        result.checked++;
        try {
          await this.remindOne(booking, now, leadMs, windowEnd, confirmedAt.get(booking.id), result);
        } catch (error) {
          // One bad booking must not stop the rest of the run
          result.errors++;
          logger.error(`Booking reminder failed for ${booking.id}:`, error);
        }
      }

      if (batch.length < BATCH_SIZE) break;
    }

    logger.info(`Booking reminders run: ${JSON.stringify(result)}`);
    return result;
  }

  /** When each booking's confirmation notification was created (if any) */
  private async confirmationTimes(bookingIds: string[]) {
    const rows = await prisma.notification.findMany({
      where: { dedupeKey: { in: bookingIds.map((id) => `booking-confirmed:${id}`) } },
      select: { dedupeKey: true, createdAt: true },
    });
    return new Map(
      rows.map((r) => [r.dedupeKey!.slice("booking-confirmed:".length), r.createdAt]),
    );
  }

  private async remindOne(
    booking: CandidateBooking,
    now: Date,
    leadMs: number,
    windowEnd: Date,
    confirmedAt: Date | undefined,
    result: ReminderRunResult,
  ) {
    const times = sessionTimes(booking);
    if (!times || times.startsAt <= now) {
      result.skipped.started++;
      return;
    }
    if (times.startsAt > windowEnd) {
      result.skipped["not-due"]++;
      return;
    }

    // Rule: no reminder when the booking was made (or confirmed) less than the
    // lead time before it starts, e.g. booked at 1:30 PM for 2:00 PM. The
    // confirmation notification and email were only just sent.
    const lastConfirmation = Math.max(
      booking.createdAt.getTime(),
      booking.payment?.paidAt?.getTime() ?? 0,
      confirmedAt?.getTime() ?? 0,
    );
    if (times.startsAt.getTime() - lastConfirmation < leadMs) {
      result.skipped["booked-late"]++;
      return;
    }

    // POS walk-in placeholder accounts can't log in or receive email
    if (isGuestEmail(booking.user.email)) {
      result.skipped.guest++;
      return;
    }

    // Re-check at send time: a booking cancelled or rescheduled since the batch
    // was read must not get a reminder for its old state.
    const fresh = await prisma.booking.findFirst({
      where: { id: booking.id, status: "CONFIRMED" },
      select: { items: { select: { slotId: true } } },
    });
    const sameSlots =
      fresh &&
      fresh.items.length === booking.items.length &&
      fresh.items.every((item) => booking.items.some((b) => b.slotId === item.slotId));
    if (!sameSlots) {
      result.skipped.changed++;
      return;
    }

    const keys = reminderKeys(booking.id, times.startsAt);
    const startTime = formatBusinessTime(times.startsAt);
    const relativeDay = relativeBusinessDay(times.startsAt, now);

    // 1) In-app first. If we crash after this, the next run skips the duplicate
    //    in-app row and still claims and sends the email, so neither is lost.
    const created = await notificationsService.createInApp({
      userId: booking.userId,
      title: `Reminder: ${booking.bookingRef} starts at ${startTime}`,
      body: `Reminder: your booking at ${times.laneName} starts at ${startTime} ${relativeDay}.`,
      dedupeKey: keys.inApp,
    });
    if (created) result.inAppCreated++;

    // 2) Email, claimed by its own keyed log row. Never throws; a failure is
    //    recorded as FAILED and retried by later runs within the retry window.
    const outcome = await emailService.sendBookingReminder(
      booking.user,
      {
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        laneName: times.laneName,
        date: formatBusinessDate(times.startsAt),
        startTime,
        duration: formatDuration(times.endsAt.getTime() - times.startsAt.getTime()),
        relativeDay,
      },
      {
        dedupeKey: keys.email,
        retryFailedSince: new Date(now.getTime() - EMAIL_RETRY_WINDOW_MS),
      },
    );
    result.emails[outcome]++;
  }
}
