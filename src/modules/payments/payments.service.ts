import Stripe from "stripe";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { stripe } from "../../config/stripe";
import { EmailService } from "../notifications/email.service";

const emailService = new EmailService();

export class PaymentsService {
  async createPaymentIntent(userId: string, bookingId: string) {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId, status: "PENDING" },
    });

    if (!booking) throw new AppError("Booking not found or already processed", 404);

    // Check for existing payment intent (idempotency)
    const existingPayment = await prisma.payment.findUnique({
      where: { bookingId },
    });

    if (existingPayment) {
      const intent = await stripe.paymentIntents.retrieve(
        existingPayment.stripePaymentIntentId
      );
      return { clientSecret: intent.client_secret };
    }

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(booking.finalAmount * 100), // Stripe uses cents
      currency: process.env.STRIPE_CURRENCY || "aud",
      metadata: { bookingId, userId, bookingRef: booking.bookingRef },
    });

    await prisma.payment.create({
      data: {
        bookingId,
        stripePaymentIntentId: intent.id,
        amount: booking.finalAmount,
        currency: "aud",
        status: "PENDING",
      },
    });

    return { clientSecret: intent.client_secret };
  }

  async confirmPayment(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });
    if (!booking) throw new AppError("Booking not found", 404);
    return booking;
  }

  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const bookingId = intent.metadata.bookingId;

        await prisma.$transaction([
          prisma.payment.update({
            where: { stripePaymentIntentId: intent.id },
            data: { status: "SUCCEEDED", paidAt: new Date() },
          }),
          prisma.booking.update({
            where: { id: bookingId },
            data: { status: "CONFIRMED" },
          }),
        ]);

        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: {
            user: true,
            items: { include: { slot: { include: { lane: true } } } },
            payment: true,
          },
        });

        if (booking) {
          await emailService.sendBookingConfirmation(booking);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        await prisma.payment.update({
          where: { stripePaymentIntentId: intent.id },
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
