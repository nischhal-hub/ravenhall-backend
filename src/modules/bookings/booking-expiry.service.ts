import { prisma } from "../../config/database";
import { stripe } from "../../config/stripe";
import { logger } from "../../config/logger";
import { EmailService, isGuestEmail } from "../notifications/email.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentsService } from "../payments/payments.service";
import { BookingsService } from "./bookings.service";
import { EXPIRED_HOLD_REASON, unpaidHoldMinutes } from "./booking-hold";

const bookingsService = new BookingsService();
const paymentsService = new PaymentsService();
const notificationsService = new NotificationsService();
const emailService = new EmailService();

const BATCH_SIZE = 25;

export type ExpiryOutcome = "expired" | "paid" | "processing" | "skipped";

export interface ExpiryRunResult {
  checked: number;
  expired: number;
  paid: number;
  processing: number;
  skipped: number;
  errors: number;
}

/**
 * Releases slots held by online bookings that stayed unpaid for
 * UNPAID_HOLD_MINUTES. POS "pay at the counter" bookings (source POS) are
 * intentionally pending and never expire. Safe to run concurrently and on
 * several instances: every write is conditional and notifications are keyed.
 */
export class BookingExpiryService {
  async runUnpaidExpiry(now = new Date()): Promise<ExpiryRunResult> {
    const cutoff = new Date(now.getTime() - unpaidHoldMinutes() * 60_000);
    const result: ExpiryRunResult = {
      checked: 0,
      expired: 0,
      paid: 0,
      processing: 0,
      skipped: 0,
      errors: 0,
    };

    let cursor: string | undefined;
    for (;;) {
      // Uses the (status, createdAt) index
      const batch = await prisma.booking.findMany({
        where: { status: "PENDING", source: "ONLINE", createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;

      for (const { id } of batch) {
        result.checked++;
        try {
          result[await this.expireOne(id, cutoff)]++;
        } catch (error) {
          // One failure (e.g. Stripe briefly down) must not stop the others;
          // the booking stays pending and is retried on the next run.
          result.errors++;
          logger.error(`Unpaid-hold expiry failed for booking ${id}:`, error);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }

    if (result.checked > 0) logger.info(`Unpaid-hold expiry run: ${JSON.stringify(result)}`);
    return result;
  }

  /** Expires one booking if it is still an unpaid online hold older than `cutoff` */
  async expireOne(bookingId: string, cutoff: Date): Promise<ExpiryOutcome> {
    const stillHeld = { status: "PENDING" as const, source: "ONLINE" as const, createdAt: { lt: cutoff } };
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, ...stillHeld },
      include: { items: { select: { slotId: true } }, payment: true, user: { select: { email: true } } },
    });
    if (!booking) return "skipped";

    // 1) Never release a booking whose money has moved or is moving.
    if (booking.payment?.status === "SUCCEEDED") return "paid";
    const intentId = booking.payment?.stripePaymentIntentId;
    if (intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status === "succeeded") {
        // Paid but the webhook hasn't landed: confirm instead of expiring
        await paymentsService.markIntentSucceeded(intent.id, booking.id);
        return "paid";
      }
      if (intent.status === "processing" || intent.status === "requires_capture") {
        return "processing"; // decide on a later run
      }
      if (intent.status !== "canceled") {
        // 2) Close checkout first, so nothing can be paid after the slot is released.
        try {
          await stripe.paymentIntents.cancel(intent.id, undefined, {
            idempotencyKey: `expire-booking-${booking.id}`,
          });
        } catch (error) {
          // Most likely the customer paid this very moment: re-check
          const latest = await stripe.paymentIntents.retrieve(intent.id);
          if (latest.status === "succeeded") {
            await paymentsService.markIntentSucceeded(latest.id, booking.id);
            return "paid";
          }
          if (latest.status !== "canceled") throw error;
        }
      }
    }

    // 3) Release through the shared cancellation core. The conditional update
    //    means only one of (webhook, this run, another instance) wins.
    const released = await prisma.$transaction(async (tx) => {
      const ok = await bookingsService.cancelInTransaction(tx, booking, {
        where: stillHeld,
        cancelledById: null,
        reason: EXPIRED_HOLD_REASON,
      });
      if (ok) await notificationsService.createBookingExpired(booking, tx);
      return ok;
    });
    if (!released) return "skipped";

    // 4) Email after commit; never throws, keyed so reruns don't resend.
    //    POS guest placeholder addresses are skipped by the email service.
    if (!isGuestEmail(booking.user.email)) await emailService.sendBookingExpired(booking.id);
    return "expired";
  }
}
