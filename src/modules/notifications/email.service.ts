import { transporter, EMAIL_FROM } from "../../config/email";
import { logger } from "../../config/logger";
import { prisma } from "../../config/database";

export class EmailService {
  private async send(to: string, subject: string, html: string) {
    try {
      await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
      logger.info(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
    }
  }

  async sendEmailVerification(email: string, firstName: string, token: string) {
    await this.send(
      email,
      "Verify your email — Ravenhall Indoor Cricket Centre",
      `<h2>Hi ${firstName},</h2>
       <p>Here is your 6 digit verification code.</p>
      <h1>${token}</h1>
       `,
    );
  }

  async sendBookingConfirmation(booking: any) {
    const user = await prisma.user.findUnique({
      where: { id: booking.userId },
    });
    if (!user) return;

    await this.send(
      user.email,
      `Booking Confirmed — ${booking.bookingRef}`,
      `<h2>Hi ${user.firstName},</h2>
       <p>Your booking <strong>${booking.bookingRef}</strong> has been confirmed.</p>
       <p>Total paid: <strong>$${booking.finalAmount.toFixed(2)} AUD</strong></p>
       <p>Thank you for booking with Ravenhall Indoor Cricket Centre.</p>`,
    );

    await prisma.notification.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        subject: `Booking Confirmed — ${booking.bookingRef}`,
        body: `Your booking ${booking.bookingRef} is confirmed.`,
        status: "SENT",
        sentAt: new Date(),
      },
    });
  }

  async sendBookingCancellation(userId: string, bookingRef: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await this.send(
      user.email,
      `Booking Cancelled — ${bookingRef}`,
      `<h2>Hi ${user.firstName},</h2>
       <p>Your booking <strong>${bookingRef}</strong> has been cancelled.</p>
       <p>If you paid online, a refund will be processed within 5–10 business days.</p>`,
    );
  }

  async sendPasswordReset(email: string, firstName: string, token: string) {
    const url = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
    await this.send(
      email,
      "Reset your password — Ravenhall Indoor Cricket Centre",
      `<h2>Hi ${firstName},</h2>
       <p>Click the link below to reset your password:</p>
       <a href="${url}">Reset Password</a>
       <p>This link expires in 1 hour. If you did not request this, please ignore.</p>`,
    );
  }
}
