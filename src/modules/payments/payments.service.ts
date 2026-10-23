import Stripe from "stripe";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { stripe } from "../../config/stripe";
import { logger } from "../../config/logger";
import { slotStartInstant } from "../../utils/businessTime";
import { NotificationsService } from "../notifications/notifications.service";

const notificationsService = new NotificationsService();

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
   * Only a PENDING booking is confirmed, so a booking cancelled meanwhile
   * isn't silently revived.
   */
  private async markIntentSucceeded(intentId: string, bookingId: string) {
    const confirmed = await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { stripePaymentIntentId: intentId, status: { not: "SUCCEEDED" } },
        data: { status: "SUCCEEDED", paidAt: new Date() },
      });
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, status: "PENDING" },
        data: { status: "CONFIRMED" },
      });
      return count === 1;
    });

    if (!confirmed) {
      const current = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { status: true },
      });
      if (current?.status === "CANCELLED") {
        logger.warn(
          `Payment ${intentId} succeeded for cancelled booking ${bookingId}; needs a manual refund`,
        );
      }
      return;
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, bookingRef: true },
    });
    // Deduped per booking, so webhook redeliveries don't notify twice
    if (booking) void notificationsService.notifyBookingConfirmed(booking);
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
