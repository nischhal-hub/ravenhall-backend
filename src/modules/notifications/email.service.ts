import { transporter, EMAIL_FROM, isEmailEnabled } from "../../config/email";
import { logger } from "../../config/logger";
import { prisma } from "../../config/database";
import { emailTemplates, EmailContent, BookingEmailDetails } from "./email.templates";

// POS walk-in customers get placeholder addresses that must never be emailed
const GUEST_EMAIL_DOMAIN = "@guest.ravenhall.com";

const isDeliverable = (email?: string | null): email is string =>
  Boolean(email) && !email!.endsWith(GUEST_EMAIL_DOMAIN);

/**
 * All public methods resolve and never throw, so callers can fire-and-forget
 * (`void emailService.sendX(...)`) without a mail failure breaking the request.
 */
export class EmailService {
  /**
   * When `log` is given, the send is recorded as an EMAIL notification keyed by
   * `log.dedupeKey`; a second call with the same key is skipped, which makes
   * retried events (e.g. Stripe webhook redelivery) send at most one email.
   */
  private async send(
    to: string | null | undefined,
    content: EmailContent,
    log?: { userId: string; dedupeKey: string },
  ) {
    if (!isDeliverable(to)) {
      logger.warn(`Skipping email "${content.subject}": no deliverable address`);
      return;
    }

    try {
      if (log) {
        const { count } = await prisma.notification.createMany({
          data: [
            {
              userId: log.userId,
              type: "EMAIL",
              subject: content.subject,
              body: content.text,
              status: "QUEUED",
              dedupeKey: log.dedupeKey,
            },
          ],
          skipDuplicates: true,
        });
        if (count === 0) {
          logger.info(`Skipping duplicate email ${log.dedupeKey}`);
          return;
        }
      }

      if (!isEmailEnabled()) {
        logger.info(`EMAIL_ENABLED=false — not sending "${content.subject}" to ${to}`);
      } else {
        await transporter.sendMail({
          from: EMAIL_FROM,
          to,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        logger.info(`Email sent to ${to}: ${content.subject}`);
      }

      if (log) {
        await prisma.notification.updateMany({
          where: { dedupeKey: log.dedupeKey },
          data: { status: "SENT", sentAt: new Date() },
        });
      }
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
      if (log) {
        await prisma.notification
          .updateMany({ where: { dedupeKey: log.dedupeKey }, data: { status: "FAILED" } })
          .catch((err) => logger.error(`Failed to record email failure:`, err));
      }
    }
  }

  private async loadBookingForEmail(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, email: true, firstName: true } },
        items: { include: { slot: { include: { lane: { select: { name: true } } } } } },
      },
    });
    if (!booking) return null;

    const slot = booking.items[0]?.slot;
    const details: BookingEmailDetails = {
      bookingRef: booking.bookingRef,
      laneName: slot?.lane.name,
      date: slot?.date,
      startTime: slot?.startTime,
      endTime: slot?.endTime,
      finalAmount: booking.finalAmount,
    };
    return { booking, details };
  }

  async sendEmailVerification(email: string, firstName: string, token: string) {
    await this.send(email, emailTemplates.emailVerification(firstName, token));
  }

  async sendWelcome(user: { id: string; email: string; firstName: string }) {
    await this.send(user.email, emailTemplates.welcome(user.firstName), {
      userId: user.id,
      dedupeKey: `email:welcome:${user.id}`,
    });
  }

  async sendBookingConfirmation(booking: { id: string }) {
    try {
      const loaded = await this.loadBookingForEmail(booking.id);
      if (!loaded) return;

      await this.send(
        loaded.booking.user.email,
        emailTemplates.bookingConfirmed(loaded.booking.user.firstName, loaded.details),
        { userId: loaded.booking.user.id, dedupeKey: `email:booking-confirmed:${booking.id}` },
      );
    } catch (error) {
      logger.error(`Failed to prepare confirmation email for booking ${booking.id}:`, error);
    }
  }

  async sendBookingCancellation(
    bookingId: string,
    opts: { cancelledBy: "customer" | "staff"; reason?: string | null; refunded?: boolean },
  ) {
    try {
      const loaded = await this.loadBookingForEmail(bookingId);
      if (!loaded) return;

      await this.send(
        loaded.booking.user.email,
        emailTemplates.bookingCancelled(loaded.booking.user.firstName, loaded.details, opts),
        { userId: loaded.booking.user.id, dedupeKey: `email:booking-cancelled:${bookingId}` },
      );
    } catch (error) {
      logger.error(`Failed to prepare cancellation email for booking ${bookingId}:`, error);
    }
  }

  async sendPasswordReset(email: string, firstName: string, token: string) {
    await this.send(email, emailTemplates.passwordReset(firstName, token));
  }
}
