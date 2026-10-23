import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { AppError } from "../../utils/AppError";
import { EmailService } from "./email.service";

const emailService = new EmailService();

type Db = Prisma.TransactionClient | typeof prisma;

export class NotificationsService {
  /**
   * Creates an in-app notification at most once per `dedupeKey`.
   * Uses ON CONFLICT DO NOTHING (skipDuplicates) so it is safe inside a transaction.
   * Returns true if a new notification was created.
   */
  async createInApp(
    data: { userId: string; title: string; body: string; dedupeKey: string },
    db: Db = prisma,
  ) {
    const { count } = await db.notification.createMany({
      data: [
        {
          userId: data.userId,
          type: "IN_APP",
          subject: data.title,
          body: data.body,
          status: "SENT",
          sentAt: new Date(),
          dedupeKey: data.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async createWelcome(user: { id: string; firstName: string }, db: Db = prisma) {
    return this.createInApp(
      {
        userId: user.id,
        title: "Welcome to Ravenhall!",
        body: `Hi ${user.firstName}, your account has been created. Book a lane any time from the Lanes page.`,
        dedupeKey: `welcome:${user.id}`,
      },
      db,
    );
  }

  async createBookingCancelled(
    booking: { id: string; userId: string; bookingRef: string },
    opts: { cancelledBy: "customer" | "staff"; reason?: string | null },
    db: Db = prisma,
  ) {
    const by = opts.cancelledBy === "staff" ? " by our staff" : "";
    const reason = opts.reason ? ` Reason: ${opts.reason}` : "";
    return this.createInApp(
      {
        userId: booking.userId,
        title: `Booking ${booking.bookingRef} cancelled`,
        body: `Your booking #${booking.bookingRef} has been cancelled${by}.${reason}`,
        dedupeKey: `booking-cancelled:${booking.id}`,
      },
      db,
    );
  }

  /**
   * Booking confirmed event: in-app notification + confirmation email.
   * Call after the confirming transaction commits. Never throws.
   */
  async notifyBookingConfirmed(booking: { id: string; userId: string; bookingRef: string }) {
    try {
      await this.createInApp({
        userId: booking.userId,
        title: `Booking ${booking.bookingRef} confirmed`,
        body: `Thank you for booking! Your booking #${booking.bookingRef} is confirmed.`,
        dedupeKey: `booking-confirmed:${booking.id}`,
      });
    } catch (error) {
      logger.error(`Failed to create confirmation notification for ${booking.id}:`, error);
    }
    void emailService.sendBookingConfirmation(booking);
  }

  async getMyNotifications(userId: string) {
    const where = { userId, type: "IN_APP" as const };
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    return { notifications, unreadCount };
  }

  async markAsRead(userId: string, id: string) {
    // Scoped by userId so users can only touch their own notifications
    const { count } = await prisma.notification.updateMany({
      where: { id, userId, type: "IN_APP" },
      data: { isRead: true, readAt: new Date() },
    });
    if (count === 0) throw new AppError("Notification not found", 404);
  }

  async markAllAsRead(userId: string) {
    const { count } = await prisma.notification.updateMany({
      where: { userId, type: "IN_APP", isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: count };
  }
}
