import Stripe from "stripe";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { stripe } from "../../config/stripe";
import { logger } from "../../config/logger";
import { hasSlotStarted, slotStartInstant } from "../../utils/businessTime";
import { generateBookingRef } from "../../utils/bookingRef";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../notifications/email.service";
import { EXPIRED_HOLD_REASON, holdExpiresAt } from "../bookings/booking-hold";
import { BookingsService, OnlineBookingRequest } from "../bookings/bookings.service";

const notificationsService = new NotificationsService();
const emailService = new EmailService();
const bookingsService = new BookingsService();

/** Stripe metadata `type` of a checkout for a new online booking */
export const BOOKING_CHECKOUT = "booking_checkout";

/** Thrown inside the re-claim transaction to roll it back */
class SlotsTaken extends Error {}

/** Thrown inside the checkout transaction when another request already finished it */
class CheckoutHandled extends Error {}

/** What the customer should be told after returning from Stripe */
export type PaymentOutcome = "paid" | "processing" | "failed" | "unpaid";

/** After paying for a new booking; "refunded" = paid, but the slot was gone */
export interface CheckoutResult {
  outcome: PaymentOutcome | "refunded";
  bookingId: string | null;
  bookingRef: string | null;
}

const NOT_BOOKED = { bookingId: null, bookingRef: null };

const toCents = (amount: number) => Math.round(amount * 100);

export class PaymentsService {
  /**
   * Starts paying for a new online booking. Nothing is booked or held yet:
   * the quote (slots and price) goes into the PaymentIntent's metadata, which
   * only the server can write, next to a PENDING payment row. The booking is
   * created once Stripe says the money arrived (completeCheckout).
   */
  async startCheckout(userId: string, data: OnlineBookingRequest) {
    const quote = await bookingsService.quoteOnlineBooking(userId, data);
    const currency = (process.env.STRIPE_CURRENCY || "aud").toLowerCase();

    const intent = await stripe.paymentIntents.create({
      amount: toCents(quote.finalAmount),
      currency,
      metadata: {
        type: BOOKING_CHECKOUT,
        userId,
        slotIds: quote.slots.map((slot) => slot.id).join(","),
        unitPrice: String(quote.unitPrice),
        itemSubtotal: String(quote.itemSubtotal),
        totalAmount: String(quote.totalAmount),
        discountAmount: String(quote.discountAmount),
        finalAmount: String(quote.finalAmount),
        ...(quote.discountCodeRecord && { discountCodeId: quote.discountCodeRecord.id }),
      },
    });

    await prisma.payment.create({
      data: {
        stripePaymentIntentId: intent.id,
        amount: quote.finalAmount,
        currency,
        status: "PENDING",
      },
    });

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount: quote.finalAmount,
      currency,
      totalAmount: quote.totalAmount,
      discountAmount: quote.discountAmount,
      discountPct: quote.discountPct,
      discountCode: quote.discountCodeRecord?.code ?? null,
    };
  }

  /**
   * Called when the customer returns from Stripe after paying for a new
   * booking. Asks Stripe for the real status, so the booking is created even
   * if the webhook is slow or missing. Only the customer who started the
   * checkout can check it.
   */
  async confirmCheckout(userId: string, paymentIntentId: string): Promise<CheckoutResult> {
    const payment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { booking: { select: { id: true, bookingRef: true, userId: true } } },
    });
    if (!payment || payment.membershipId) throw new AppError("Payment not found", 404);

    if (payment.booking) {
      if (payment.booking.userId !== userId) throw new AppError("Payment not found", 404);
      return { outcome: "paid", bookingId: payment.booking.id, bookingRef: payment.booking.bookingRef };
    }

    // No booking yet, so ownership comes from the metadata we wrote at checkout
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.metadata?.type !== BOOKING_CHECKOUT || intent.metadata.userId !== userId) {
      throw new AppError("Payment not found", 404);
    }
    if (payment.status === "REFUNDED") return { outcome: "refunded", ...NOT_BOOKED };
    if (intent.status === "succeeded") return this.completeCheckout(intent);
    if (intent.status === "processing") return { outcome: "processing", ...NOT_BOOKED };
    if (intent.last_payment_error) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      return { outcome: "failed", ...NOT_BOOKED };
    }
    return { outcome: "unpaid", ...NOT_BOOKED };
  }

  /**
   * Turns a paid checkout into a CONFIRMED booking. Shared by the webhook and
   * confirmCheckout, and idempotent: our payment row is the lock, so only one
   * of them creates the booking. The slots weren't held while the customer
   * paid; if they were taken or have started meanwhile, the payment is
   * refunded in full instead.
   */
  async completeCheckout(intent: Stripe.PaymentIntent): Promise<CheckoutResult> {
    const payment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (
      intent.status !== "succeeded" ||
      intent.metadata?.type !== BOOKING_CHECKOUT ||
      !payment ||
      payment.membershipId
    ) {
      logger.warn(`Payment ${intent.id} is not a paid booking checkout; nothing to book`);
      return { outcome: "unpaid", ...NOT_BOOKED };
    }
    // Already booked or refunded (webhook redelivered, or the return page got there first)
    if (payment.bookingId || payment.status === "REFUNDED") return this.checkoutResult(payment.id);

    const meta = intent.metadata;
    const userId = meta.userId;
    const slotIds = (meta.slotIds ?? "").split(",").filter(Boolean);
    const finalAmount = Number(meta.finalAmount);

    const slots = await prisma.timeSlot.findMany({ where: { id: { in: slotIds } } });
    const bookable =
      slotIds.length > 0 &&
      slots.length === slotIds.length &&
      !slots.some((slot) => hasSlotStarted(slot)) &&
      intent.amount_received >= toCents(finalAmount) &&
      intent.currency === payment.currency;
    if (!bookable) return this.refundCheckout(intent, payment.id, userId);

    let booking: { id: string; bookingRef: string };
    try {
      booking = await prisma.$transaction(
        async (tx) => {
          const { count } = await tx.payment.updateMany({
            where: { id: payment.id, bookingId: null, status: { in: ["PENDING", "FAILED"] } },
            data: { status: "SUCCEEDED", paidAt: new Date() },
          });
          if (count === 0) throw new CheckoutHandled();

          // All or nothing: a slot booked by someone else meanwhile rolls it all back
          const claimed = await tx.timeSlot.updateMany({
            where: { id: { in: slotIds }, isAvailable: true, isBlocked: false },
            data: { isAvailable: false },
          });
          if (claimed.count !== slotIds.length) throw new SlotsTaken();

          // The customer paid the quoted price, so the use counts even if the
          // code ran out meanwhile. A code deleted since is just not linked.
          let discountCodeId: string | null = null;
          if (meta.discountCodeId) {
            const used = await tx.discountCode.updateMany({
              where: { id: meta.discountCodeId },
              data: { usedCount: { increment: 1 } },
            });
            if (used.count === 1) discountCodeId = meta.discountCodeId;
          }

          const created = await tx.booking.create({
            data: {
              bookingRef: generateBookingRef(),
              userId,
              status: "CONFIRMED",
              totalAmount: Number(meta.totalAmount),
              discountAmount: Number(meta.discountAmount),
              finalAmount,
              discountCodeId,
              items: {
                create: slotIds.map((slotId) => ({
                  slotId,
                  unitPrice: Number(meta.unitPrice),
                  subtotal: Number(meta.itemSubtotal),
                })),
              },
            },
          });
          await tx.payment.update({ where: { id: payment.id }, data: { bookingId: created.id } });
          return created;
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof CheckoutHandled) return this.checkoutResult(payment.id);
      if (error instanceof SlotsTaken) return this.refundCheckout(intent, payment.id, userId);
      throw error;
    }

    // Deduped per booking, so a retry never notifies twice
    void notificationsService.notifyBookingConfirmed({ id: booking.id, userId, bookingRef: booking.bookingRef });
    return { outcome: "paid", bookingId: booking.id, bookingRef: booking.bookingRef };
  }

  /**
   * A checkout was paid but can't become a booking: refund it in full, once.
   * Moving the payment to REFUNDED first means the webhook and the return page
   * can't both refund, or book after the refund. A refund error is rethrown
   * (after undoing that) so Stripe retries the webhook rather than leaving
   * the customer charged.
   */
  private async refundCheckout(
    intent: Stripe.PaymentIntent,
    paymentId: string,
    userId: string,
  ): Promise<CheckoutResult> {
    const { count } = await prisma.payment.updateMany({
      where: { id: paymentId, bookingId: null, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "REFUNDED", refundAmount: intent.amount_received / 100 },
    });
    if (count === 0) return this.checkoutResult(paymentId);

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create(
        { payment_intent: intent.id },
        { idempotencyKey: `refund-checkout-${intent.id}` },
      );
    } catch (error) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "PENDING", refundAmount: null },
      });
      throw error;
    }
    await prisma.payment.update({ where: { id: paymentId }, data: { stripeRefundId: refund.id } });
    logger.warn(`Checkout ${intent.id} was paid but its slots were no longer bookable; refunded (${refund.id})`);

    try {
      await notificationsService.createCheckoutRefunded(userId, intent.id);
    } catch (error) {
      logger.error(`Failed to notify about refunded checkout ${intent.id}:`, error);
    }
    return { outcome: "refunded", ...NOT_BOOKED };
  }

  /** Where a checkout's payment ended up, read back from our own records */
  private async checkoutResult(paymentId: string): Promise<CheckoutResult> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true, booking: { select: { id: true, bookingRef: true } } },
    });
    if (payment?.booking) {
      return { outcome: "paid", bookingId: payment.booking.id, bookingRef: payment.booking.bookingRef };
    }
    return { outcome: payment?.status === "REFUNDED" ? "refunded" : "unpaid", ...NOT_BOOKED };
  }

  /**
   * Returns a client secret to pay for an existing PENDING booking (a POS
   * "pay at the counter" booking, or one made before checkout created
   * bookings only once paid). New online bookings use startCheckout. Safe to call again
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
        await this.markIntentSucceeded(intent);
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
        await this.markIntentSucceeded(intent);
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
   *
   * The booking comes from our own Payment row, never from Stripe metadata,
   * and is only confirmed when Stripe says the intent succeeded for the full
   * amount. (A membership intent has no booking: it must never get here.)
   */
  async markIntentSucceeded(intent: Stripe.PaymentIntent) {
    if (intent.status !== "succeeded") return;

    const payment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
      include: { booking: { select: { id: true, finalAmount: true } } },
    });
    if (!payment?.booking) {
      logger.warn(`Succeeded payment ${intent.id} is not a booking payment; nothing to confirm`);
      return;
    }

    const bookingId = payment.booking.id;
    const expected = toCents(payment.booking.finalAmount);
    if (intent.amount_received < expected || intent.currency !== payment.currency) {
      // Left PENDING for staff to look at rather than confirming an underpaid booking
      logger.error(
        `Payment ${intent.id} for booking ${bookingId} received ${intent.amount_received} ${intent.currency}, expected ${expected} ${payment.currency}; not confirming`,
      );
      return;
    }

    const intentId = intent.id;
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
        // Membership checkouts share this webhook but are activated by the
        // memberships flow. Treating them as booking payments used to confirm
        // every PENDING booking (no bookingId => no id filter).
        if (intent.metadata?.type === "membership") break;
        // A new online booking: it is created here, now that it's paid
        if (intent.metadata?.type === BOOKING_CHECKOUT) {
          await this.completeCheckout(intent);
          break;
        }
        await this.markIntentSucceeded(intent);
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
