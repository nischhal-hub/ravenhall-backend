import { transporter, EMAIL_FROM, isEmailEnabled } from "../../config/email";
import { logger } from "../../config/logger";
import { prisma } from "../../config/database";
import { emailTemplates, EmailContent, BookingEmailDetails } from "./email.templates";

// POS walk-in customers get placeholder addresses that must never be emailed
const GUEST_EMAIL_DOMAIN = "@guest.ravenhall.com";

const isDeliverable = (email?: string | null): email is string =>
  Boolean(email) && !email!.endsWith(GUEST_EMAIL_DOMAIN);

/** POS walk-in placeholder account (no real address, no app login) */
export const isGuestEmail = (email?: string | null) =>
  Boolean(email) && email!.endsWith(GUEST_EMAIL_DOMAIN);

/** What happened to one keyed send */
export type EmailOutcome = "sent" | "failed" | "duplicate" | "skipped";

/**
 * All public methods resolve and never throw, so callers can fire-and-forget
 * (`void emailService.sendX(...)`) without a mail failure breaking the request.
 */
export class EmailService {
  /**
   * When `log` is given, the send is recorded as an EMAIL notification keyed by
   * `log.dedupeKey`; a second call with the same key is skipped, which makes
   * retried events (e.g. Stripe webhook redelivery) send at most one email.
   *
   * `log.retryFailedSince` opts in to retrying: a FAILED row created at or after
   * that time is atomically flipped back to QUEUED and sent again. The flip only
   * matches a FAILED row, so concurrent retries still send at most once.
   */
  private async send(
    to: string | null | undefined,
    content: EmailContent,
    log?: { userId: string; dedupeKey: string; retryFailedSince?: Date },
  ): Promise<EmailOutcome> {
    if (!isDeliverable(to)) {
      logger.warn(`Skipping email "${content.subject}": no deliverable address`);
      return "skipped";
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
          const reclaimed = log.retryFailedSince
            ? await prisma.notification.updateMany({
                where: {
                  dedupeKey: log.dedupeKey,
                  status: "FAILED",
                  createdAt: { gte: log.retryFailedSince },
                },
                data: { status: "QUEUED" },
              })
            : { count: 0 };
          if (reclaimed.count === 0) {
            logger.info(`Skipping duplicate email ${log.dedupeKey}`);
            return "duplicate";
          }
          logger.info(`Retrying failed email ${log.dedupeKey}`);
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
      return "sent";
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
      if (log) {
        await prisma.notification
          .updateMany({ where: { dedupeKey: log.dedupeKey }, data: { status: "FAILED" } })
          .catch((err) => logger.error(`Failed to record email failure:`, err));
      }
      return "failed";
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

  /**
   * Booking reminder, keyed per booking *and* start time so a rescheduled booking
   * gets its own reminder. A FAILED send may be retried by later job runs while
   * `retryFailedSince` allows it (the reminders service bounds that window).
   */
  async sendBookingReminder(
    user: { id: string; email: string; firstName: string },
    reminder: Parameters<typeof emailTemplates.bookingReminder>[1],
    log: { dedupeKey: string; retryFailedSince: Date },
  ): Promise<EmailOutcome> {
    try {
      return await this.send(user.email, emailTemplates.bookingReminder(user.firstName, reminder), {
        userId: user.id,
        ...log,
      });
    } catch (error) {
      logger.error(`Failed to prepare reminder email ${log.dedupeKey}:`, error);
      return "failed";
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

  /** Unpaid hold expired. Keyed per booking, so retries never send twice. */
  async sendBookingExpired(bookingId: string): Promise<EmailOutcome> {
    try {
      const loaded = await this.loadBookingForEmail(bookingId);
      if (!loaded) return "skipped";
      return await this.send(
        loaded.booking.user.email,
        emailTemplates.bookingExpired(loaded.booking.user.firstName, loaded.details),
        { userId: loaded.booking.user.id, dedupeKey: `email:booking-expired:${bookingId}` },
      );
    } catch (error) {
      logger.error(`Failed to prepare expiry email for booking ${bookingId}:`, error);
      return "failed";
    }
  }

  /** Payment arrived after expiry and the slot was gone, so it was refunded */
  async sendLatePaymentRefunded(bookingId: string): Promise<EmailOutcome> {
    try {
      const loaded = await this.loadBookingForEmail(bookingId);
      if (!loaded) return "skipped";
      return await this.send(
        loaded.booking.user.email,
        emailTemplates.latePaymentRefunded(loaded.booking.user.firstName, loaded.details),
        { userId: loaded.booking.user.id, dedupeKey: `email:booking-late-refund:${bookingId}` },
      );
    } catch (error) {
      logger.error(`Failed to prepare late-refund email for booking ${bookingId}:`, error);
      return "failed";
    }
  }

  async sendPasswordReset(email: string, firstName: string, token: string) {
    await this.send(email, emailTemplates.passwordReset(firstName, token));
  }
}
