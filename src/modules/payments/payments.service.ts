import Stripe from "stripe";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { stripe } from "../../config/stripe";
import { logger } from "../../config/logger";
import { hasSlotStarted, slotStartInstant } from "../../utils/businessTime";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../notifications/email.service";
import { EXPIRED_HOLD_REASON, holdExpiresAt } from "../bookings/booking-hold";

const notificationsService = new NotificationsService();
const emailService = new EmailService();

/** Thrown inside the re-claim transaction to roll it back */
class SlotsTaken extends Error {}

/** What the customer should be told after returning from Stripe */
export type PaymentOutcome = "paid" | "processing" | "failed" | "unpaid";

const toCents = (amount: number) => Math.round(amount * 100);

export class PaymentsService {
  /**
   * Returns a client secret to pay for a PENDING booking. Safe to call again
   * (e.g. "Complete payment" after leaving checkout): it reuses the booking's
   * Stripe PaymentIntent, replaces one Stripe has cancelled, and keeps the
   * amount in sync with the booking total.
   */
  async createPaymentIntent(userId: string, bookingId: string) {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId, status: "PENDING" },
      include: {
        payment: true,
        items: { include: { slot: { select: { date: true, startTime: true } } } },
      },
    });

    if (!booking) throw new AppError("Booking not found or already processed", 404);

    // A session that has already started can't be paid for any more
    const startsAt = booking.items
      .map((item) => slotStartInstant(item.slot.date, item.slot.startTime))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (startsAt && startsAt <= new Date()) {
      throw new AppError(
        "This session has already started, so it can no longer be paid for. Cancel it and book a new time.",
        409,
      );
    }

    const amount = toCents(booking.finalAmount);
    const currency = (process.env.STRIPE_CURRENCY || "aud").toLowerCase();
    const existing = booking.payment;

    // The unpaid hold has run out: the expiry job is about to release the slot
    const assertHoldActive = () => {
      const expiresAt = holdExpiresAt(booking);
      if (expiresAt && expiresAt <= new Date()) {
        throw new AppError(
          "The hold on this booking has expired, so it can no longer be paid for. Please book again.",
          409,
        );
      }
    };

    if (existing?.stripePaymentIntentId) {
      let intent = await stripe.paymentIntents.retrieve(existing.stripePaymentIntentId);

      if (intent.status === "succeeded") {
        // Paid, but the webhook hasn't landed yet: confirm now instead of charging again
        await this.markIntentSucceeded(intent.id, booking.id);
        throw new AppError("This booking is already paid.", 409);
      }
      if (intent.status === "processing") {
        throw new AppError(
          "Your last payment is still processing. Please check back in a minute.",
          409,
        );
      }
      assertHoldActive();
      if (intent.status !== "canceled") {
        if (intent.amount !== amount) {
          intent = await stripe.paymentIntents.update(intent.id, { amount });
          await prisma.payment.update({
            where: { id: existing.id },
            data: { amount: booking.finalAmount },
          });
        }
        return { clientSecret: intent.client_secret, amount: booking.finalAmount, currency };
      }
      // Cancelled by Stripe (e.g. expired): fall through and start a fresh one
    }

    assertHoldActive();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: { bookingId, userId, bookingRef: booking.bookingRef },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: {
          stripePaymentIntentId: intent.id,
          amount: booking.finalAmount,
          currency,
          status: "PENDING",
        },
      });
    } else {
      await prisma.payment.create({
        data: {
          bookingId,
          stripePaymentIntentId: intent.id,
          amount: booking.finalAmount,
          currency,
          status: "PENDING",
        },
      });
    }

    return { clientSecret: intent.client_secret, amount: booking.finalAmount, currency };
  }

  /**
   * Called when the customer returns from Stripe. Asks Stripe for the real
   * status so the booking confirms even if the webhook is slow or missing.
   * Only the booking's owner can check it.
   */
  async confirmPayment(userId: string, bookingId: string) {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: { payment: true },
    });
    if (!booking) throw new AppError("Booking not found", 404);

    const payment = booking.payment;
    let outcome: PaymentOutcome =
      booking.status === "CONFIRMED" ||
      booking.status === "COMPLETED" ||
      payment?.status === "SUCCEEDED"
        ? "paid"
        : payment?.status === "FAILED"
          ? "failed"
          : "unpaid";

    if (booking.status === "PENDING" && payment?.stripePaymentIntentId && outcome !== "paid") {
      const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
      if (intent.status === "succeeded") {
        await this.markIntentSucceeded(intent.id, booking.id);
        outcome = "paid";
      } else if (intent.status === "processing") {
        outcome = "processing";
      } else if (intent.last_payment_error) {
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: intent.id, status: "PENDING" },
          data: { status: "FAILED" },
        });
        outcome = "failed";
      }
    }

    return { bookingId: booking.id, bookingRef: booking.bookingRef, outcome };
  }

  /**
   * Records a successful payment and confirms the booking. Shared by the
   * webhook and confirmPayment, and idempotent: running it twice is harmless.
   * Only a PENDING booking is confirmed; a payment for a booking that was
   * cancelled meanwhile (e.g. its unpaid hold expired) goes through
   * `handlePaymentForCancelledBooking`, so nobody is left charged with no booking.
   */
  async markIntentSucceeded(intentId: string, bookingId: string) {
    const confirmed = await prisma.$transaction(async (tx) => {
      // Never overwrite a refund (e.g. a webhook redelivered after we refunded)
      await tx.payment.updateMany({
        where: {
          stripePaymentIntentId: intentId,
          status: { notIn: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
        },
        data: { status: "SUCCEEDED", paidAt: new Date() },
      });
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, status: "PENDING" },
        data: { status: "CONFIRMED" },
      });
      return count === 1;
    });

    if (!confirmed) {
      await this.handlePaymentForCancelledBooking(intentId, bookingId);
      return;
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, bookingRef: true },
    });
    // Deduped per booking, so webhook redeliveries don't notify twice
    if (booking) void notificationsService.notifyBookingConfirmed(booking);
  }

  /**
   * Money arrived for a booking that is already CANCELLED.
   * - Hold expired (system) and every slot is still free and in the future:
   *   claim the slots back and confirm the booking.
   * - Otherwise: refund in full, once (same idempotency key as the cancel
   *   flow), and tell the customer. A refund error is rethrown so Stripe
   *   retries the webhook rather than leaving the customer charged.
   */
  private async handlePaymentForCancelledBooking(intentId: string, bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { slot: true } }, payment: true },
    });
    if (!booking || booking.status !== "CANCELLED") return;

    if (
      booking.cancellationReason === EXPIRED_HOLD_REASON &&
      booking.items.length > 0 &&
      !booking.items.some((item) => hasSlotStarted(item.slot))
    ) {
      const slotIds = booking.items.map((item) => item.slotId);
      const reclaimed = await prisma
        .$transaction(async (tx) => {
          const claimed = await tx.timeSlot.updateMany({
            where: { id: { in: slotIds }, isAvailable: true, isBlocked: false },
            data: { isAvailable: false },
          });
          // All or nothing: a partial claim rolls back
          if (claimed.count !== slotIds.length) throw new SlotsTaken();
          const { count } = await tx.booking.updateMany({
            where: { id: bookingId, status: "CANCELLED", cancellationReason: EXPIRED_HOLD_REASON },
            data: {
              status: "CONFIRMED",
              cancelledAt: null,
              cancelledById: null,
              cancellationReason: null,
            },
          });
          if (count !== 1) throw new SlotsTaken();
          return true;
        })
        .catch((error) => {
          if (error instanceof SlotsTaken) return false;
          throw error;
        });

      if (reclaimed) {
        logger.info(`Late payment ${intentId}: re-claimed slots, booking ${bookingId} confirmed`);
        void notificationsService.notifyBookingConfirmed(booking);
        return;
      }
    }

    const refund = await stripe.refunds.create(
      { payment_intent: intentId },
      { idempotencyKey: `refund-booking-${bookingId}` },
    );
    await prisma.payment.updateMany({
      where: { stripePaymentIntentId: intentId, status: { not: "REFUNDED" } },
      data: {
        status: "REFUNDED",
        refundAmount: booking.payment?.amount ?? null,
        stripeRefundId: refund.id,
      },
    });
    logger.warn(`Late payment ${intentId} for cancelled booking ${bookingId} refunded (${refund.id})`);
    await notificationsService.createLatePaymentRefunded(booking);
    void emailService.sendLatePaymentRefunded(bookingId);
  }

  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        await this.markIntentSucceeded(intent.id, intent.metadata.bookingId);
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: intent.id, status: { not: "SUCCEEDED" } },
          data: { status: "FAILED" },
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (charge.payment_intent) {
          await prisma.payment.updateMany({
            where: { stripePaymentIntentId: charge.payment_intent as string },
            data: { status: "REFUNDED", refundAmount: charge.amount_refunded / 100 },
          });
        }
        break;
      }
    }
  }
}
