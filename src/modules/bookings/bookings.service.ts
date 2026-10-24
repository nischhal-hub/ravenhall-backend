import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { generateBookingRef } from '../../utils/bookingRef';
import { EQUIPMENT_FEE } from '../../utils/pricing';
import { buildPaginationMeta, PaginationParams } from '../../utils/pagination';
import { stripe } from '../../config/stripe';
import { logger } from '../../config/logger';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingStatus, DiscountCode, Prisma, Role } from '@prisma/client';
import { hasSlotStarted } from '../../utils/businessTime';
import { holdExpiresAt } from './booking-hold';
import { checkDiscountCode, claimDiscountUse } from '../discounts/discounts.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** User fields safe to return alongside a booking */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isEmailVerified: true,
  createdAt: true,
} as const;

export const SLOT_STARTED_MESSAGE =
  'This time slot has already started. Please choose a later slot.';

const emailService = new EmailService();
const notificationsService = new NotificationsService();

export type BookingActor = { id: string; role: Role };

const isStaff = (actor: BookingActor) =>
  actor.role === 'ADMIN' || actor.role === 'STAFF';

// CANCELLED and COMPLETED are terminal
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
};

const assertTransition = (from: BookingStatus, to: BookingStatus) => {
  if (BOOKING_TRANSITIONS[from].includes(to)) return;
  if (from === to) {
    throw new AppError(`Booking is already ${from.toLowerCase()}`, 409);
  }
  throw new AppError(
    `Cannot change a ${from.toLowerCase()} booking to ${to.toLowerCase()}`,
    409,
  );
};

export class BookingsService {
  async createBooking(
    userId: string,
    data: { slotId: string; duration?: number; discountCode?: string },
  ) {
    const duration = data.duration ?? 1;

    // All reads outside the transaction
    const startSlot = await prisma.timeSlot.findUnique({
      where: { id: data.slotId },
      include: { lane: true },
    });

    if (!startSlot) throw new AppError('Time slot not found', 404);
    // Online and admin bookings can't start in the past. Walk-ins for the hour
    // already under way go through POS, which has its own grace period.
    if (hasSlotStarted(startSlot)) throw new AppError(SLOT_STARTED_MESSAGE, 422);

    // A multi-hour session is `duration` back-to-back hourly slots on the same
    // lane and day, starting at the chosen slot.
    const slots = await this.resolveConsecutiveSlots(startSlot, duration);

    const membership = await prisma.membership.findFirst({
      where: { userId, isActive: true, endDate: { gt: new Date() } },
    });

    const unitPrice = startSlot.lane.hourlyRate;
    const laneHire = unitPrice * slots.length;
    const totalAmount = laneHire + EQUIPMENT_FEE;

    const membershipPct = membership?.discountPct ?? 0;
    let discountPct = membershipPct;
    let discountCodeRecord: DiscountCode | null = null;

    if (data.discountCode?.trim()) {
      const check = await checkDiscountCode(data.discountCode, totalAmount);
      // A code the customer typed must not silently price at full rate
      if (!check.valid) throw new AppError(check.message, 422);
      // Only attach (and use up) the code when it beats the membership discount
      if (check.record.discountPct > membershipPct) {
        discountCodeRecord = check.record;
        discountPct = check.record.discountPct;
      }
    }
    const discountAmount = (laneHire * discountPct) / 100;
    const finalAmount = totalAmount - discountAmount;
    const itemSubtotal = unitPrice - (unitPrice * discountPct) / 100;

    // Transaction: only fast atomic writes, no includes
    const bookingId = await prisma.$transaction(
      async (tx) => {
        const slotIds = slots.map((s) => s.id);

        // Re-check every slot inside the transaction, and claim them atomically:
        // the conditional updateMany only matches slots that are still free.
        const claimed = await tx.timeSlot.updateMany({
          where: { id: { in: slotIds }, isAvailable: true, isBlocked: false },
          data: { isAvailable: false },
        });

        if (claimed.count !== slotIds.length) {
          throw new AppError(
            slotIds.length > 1
              ? 'One or more of the selected slots is no longer available'
              : 'This slot is no longer available',
            409,
          );
        }

        const booking = await tx.booking.create({
          data: {
            bookingRef: generateBookingRef(),
            userId,
            totalAmount,
            discountAmount,
            finalAmount,
            discountCodeId: discountCodeRecord?.id,
            items: {
              create: slots.map((slot) => ({
                slotId: slot.id,
                unitPrice,
                subtotal: itemSubtotal,
              })),
            },
          },
        });

        if (discountCodeRecord) {
          await claimDiscountUse(tx, discountCodeRecord);
        }

        return booking.id;
      },
      { timeout: 15000 },
    );

    // Request received, payment still due. The "confirmed" email only goes out
    // once payment is verified (PaymentsService.markIntentSucceeded).
    void emailService.sendBookingReceived({ id: bookingId });

    // Fetch full booking with relations after transaction closes
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: { slot: { include: { lane: true } } },
          orderBy: { slot: { startTime: 'asc' } },
        },
      },
    });
  }

  /**
   * Returns `duration` consecutive, bookable slots on the same lane and date,
   * beginning with `startSlot`. Throws 409 if any are taken, blocked or missing.
   */
  private async resolveConsecutiveSlots(
    startSlot: { id: string; laneId: string; date: Date; startTime: string },
    duration: number,
  ) {
    const candidates = await prisma.timeSlot.findMany({
      where: {
        laneId: startSlot.laneId,
        date: startSlot.date,
        startTime: { gte: startSlot.startTime },
      },
      orderBy: { startTime: 'asc' },
      take: duration,
    });

    const unavailable = () =>
      new AppError(
        duration > 1
          ? `The ${duration}-hour session is not available from this start time`
          : 'This slot is no longer available',
        409,
      );

    if (candidates.length < duration) throw unavailable();

    candidates.forEach((slot, i) => {
      const prev = candidates[i - 1];
      if (
        !slot.isAvailable ||
        slot.isBlocked ||
        (prev && prev.endTime !== slot.startTime)
      ) {
        throw unavailable();
      }
    });

    return candidates;
  }

  async getAllBookings(params: {
    page: number;
    limit: number;
    skip: number;
    search?: string;
    sortBy?: string;
    order?: 'asc' | 'desc';
  }) {
    const {
      page,
      limit,
      skip,
      search = '',
      sortBy = 'createdAt',
      order = 'desc',
    } = params;

    const where: Prisma.BookingWhereInput = search
      ? {
          OR: [
            {
              user: {
                firstName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              id: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ],
        }
      : {};

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: { select: SAFE_USER_SELECT },
          items: {
            include: {
              slot: {
                include: { lane: true },
              },
            },
          },
          payment: true,
          discountCode: true,
        },
        orderBy: {
          [sortBy]: order,
        },
        skip,
        take: limit,
      }),

      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      meta: buildPaginationMeta(total, page, limit),
    };
  }
  async getMyBookings(
    userId: string,
    params: {
      page?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
      order?: 'asc' | 'desc';
    },
  ) {
    const {
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      order = 'desc',
    } = params;
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (search) {
      where.OR = [
        { bookingRef: { contains: search, mode: 'insensitive' } },
        {
          items: {
            some: {
              slot: {
                lane: { name: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            // ← Add this
            select: { firstName: true, lastName: true, email: true },
          },
          items: {
            include: {
              slot: {
                include: {
                  lane: { select: { name: true, type: true } },
                },
              },
            },
          },
          payment: true,
        },
        orderBy: { [sortBy]: order },
        skip,
        take: limit,
      }),

      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Customers may only read their own bookings; staff and admins can read any.
   * A booking that belongs to someone else returns 404 (not 403) so IDs can't
   * be probed.
   */
  async getBookingById(id: string, actor: BookingActor) {
    const booking = await prisma.booking.findFirst({
      where: isStaff(actor) ? { id } : { id, userId: actor.id },
      include: {
        items: { include: { slot: { include: { lane: true } } } },
        payment: true,
        // Only what the pages show: never the password hash or codes/tokens
        user: { select: SAFE_USER_SELECT },
        discountCode: true,
      },
    });
    if (!booking) throw new AppError('Booking not found', 404);
    // Server-provided deadline for the "pay within mm:ss" countdown
    return { ...booking, holdExpiresAt: holdExpiresAt(booking)?.toISOString() ?? null };
  }
  async updateBooking(
    bookingId: string,
    userId: string,
    data: {
      slotId?: string;
      notes?: string;
    },
  ) {
    // Fetch existing booking
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: {
        items: { include: { slot: { include: { lane: true } } } },
        payment: true,
      },
    });

    if (!booking) throw new AppError('Booking not found or access denied', 404);
    if (booking.status !== 'CONFIRMED') {
      throw new AppError('Only confirmed bookings can be updated', 400);
    }
    if (
      data.slotId &&
      booking.items.length > 1 &&
      data.slotId !== booking.items[0]?.slotId
    ) {
      throw new AppError(
        'Multi-hour bookings cannot be rescheduled; cancel and rebook instead',
        400,
      );
    }

    return prisma.$transaction(async (tx) => {
      let newSlot = null;

      // Handle slot change (rescheduling)
      if (data.slotId && data.slotId !== booking.items[0]?.slotId) {
        newSlot = await tx.timeSlot.findUnique({
          where: { id: data.slotId },
          include: { lane: true },
        });

        if (!newSlot) throw new AppError('New time slot not found', 404);
        if (hasSlotStarted(newSlot)) throw new AppError(SLOT_STARTED_MESSAGE, 422);
        if (!newSlot.isAvailable || newSlot.isBlocked) {
          throw new AppError('Selected time slot is no longer available', 409);
        }

        // Restore old slot availability
        await tx.timeSlot.update({
          where: { id: booking.items[0].slotId },
          data: { isAvailable: true },
        });

        // Block new slot
        await tx.timeSlot.update({
          where: { id: data.slotId },
          data: { isAvailable: false },
        });

        // Update booking item with new slot
        await tx.bookingItem.update({
          where: { id: booking.items[0].id },
          data: {
            slotId: data.slotId,
            unitPrice: newSlot.lane.hourlyRate,
            subtotal: newSlot.lane.hourlyRate, // You can improve with membership logic
          },
        });

        // Update booking amounts
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            totalAmount: newSlot.lane.hourlyRate + EQUIPMENT_FEE,
            finalAmount: newSlot.lane.hourlyRate + EQUIPMENT_FEE, // Add discount logic later
          },
        });
      }

      // Update notes or other fields
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          notes: data.notes !== undefined ? data.notes : booking.notes,
        },
        include: {
          items: { include: { slot: { include: { lane: true } } } },
          payment: true,
          user: { select: SAFE_USER_SELECT },
        },
      });

      return updatedBooking;
    });
  }
  /**
   * Adds a promo code to an existing booking that hasn't been paid yet.
   * Same rules as at checkout (active, dates, usage limit, minimum spend).
   * One code per booking, and it replaces the membership discount only when
   * it is worth more. An open Stripe checkout is updated in the same
   * transaction, so the customer is charged the new price.
   */
  async applyDiscountCode(id: string, actor: BookingActor, code: string) {
    if (!code?.trim()) throw new AppError('Enter a discount code', 422);

    const booking = await prisma.booking.findFirst({
      where: isStaff(actor) ? { id } : { id, userId: actor.id },
      include: { items: true, payment: true },
    });
    if (!booking) throw new AppError('Booking not found', 404);

    if (booking.status !== 'PENDING' || booking.payment?.status === 'SUCCEEDED') {
      throw new AppError('A discount code can only be added before the booking is paid', 409);
    }
    if (booking.source !== 'ONLINE') {
      throw new AppError('Discounts for counter bookings are applied at the POS', 409);
    }
    if (booking.discountCodeId) {
      throw new AppError('A discount code has already been applied to this booking', 409);
    }
    const expiresAt = holdExpiresAt(booking);
    if (expiresAt && expiresAt <= new Date()) {
      throw new AppError('The hold on this booking has expired. Please book again.', 409);
    }

    const check = await checkDiscountCode(code, booking.totalAmount);
    if (!check.valid) throw new AppError(check.message, 422);
    const record = check.record;

    // Only lane hire is discountable; the equipment fee never is
    const laneHire = booking.items.reduce((sum, item) => sum + item.unitPrice, 0);
    const discountAmount = round2((laneHire * record.discountPct) / 100);
    if (discountAmount <= booking.discountAmount) {
      throw new AppError('Your current discount is already better than this code', 422);
    }
    const finalAmount = round2(booking.totalAmount - discountAmount);

    await prisma.$transaction(
      async (tx) => {
        // Conditional: loses cleanly to a concurrent apply, payment or cancel
        const { count } = await tx.booking.updateMany({
          where: { id, status: 'PENDING', discountCodeId: null },
          data: { discountCodeId: record.id, discountAmount, finalAmount },
        });
        if (count === 0) {
          throw new AppError('This booking was just updated. Please refresh and try again.', 409);
        }

        for (const item of booking.items) {
          await tx.bookingItem.update({
            where: { id: item.id },
            data: { subtotal: round2(item.unitPrice - (item.unitPrice * record.discountPct) / 100) },
          });
        }

        await claimDiscountUse(tx, record);

        if (booking.payment?.stripePaymentIntentId) {
          // Last step: if Stripe refuses, everything above rolls back
          await this.syncOpenCheckoutAmount(booking.payment.stripePaymentIntentId, finalAmount);
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: { amount: finalAmount },
          });
        }
      },
      { timeout: 15000 },
    );

    return this.getBookingById(id, actor);
  }

  /** Re-prices an unpaid Stripe PaymentIntent; refuses once money is moving */
  private async syncOpenCheckoutAmount(intentId: string, amount: number) {
    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(intentId);
    } catch (error: any) {
      logger.error(`Could not load payment ${intentId}: ${error?.message}`, error);
      throw new AppError("We couldn't update your payment. Please try again.", 502);
    }

    if (intent.status === 'succeeded' || intent.status === 'processing') {
      throw new AppError(
        'A payment for this booking is already in progress, so the code can no longer be added.',
        409,
      );
    }
    // A cancelled intent is replaced (at the new price) on the next checkout
    if (intent.status === 'canceled') return;

    try {
      await stripe.paymentIntents.update(intentId, { amount: Math.round(amount * 100) });
    } catch (error: any) {
      logger.error(`Could not re-price payment ${intentId}: ${error?.message}`, error);
      throw new AppError("We couldn't update your payment. Please try again.", 502);
    }
  }

  /**
   * Core of every cancellation (customer, staff, and the unpaid-hold expiry):
   * flips the booking to CANCELLED only if it still matches `where`, then
   * releases its slots. Returns false when nothing matched, e.g. a concurrent
   * request or a payment webhook got there first.
   */
  async cancelInTransaction(
    tx: Prisma.TransactionClient,
    booking: { id: string; items: { slotId: string }[] },
    opts: {
      where: Prisma.BookingWhereInput;
      cancelledById: string | null;
      reason: string | null;
    },
  ) {
    const { count } = await tx.booking.updateMany({
      where: { ...opts.where, id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: opts.cancelledById,
        cancellationReason: opts.reason,
      },
    });
    if (count === 0) return false;

    // Restore slot availability
    await tx.timeSlot.updateMany({
      where: { id: { in: booking.items.map((item) => item.slotId) } },
      data: { isAvailable: true },
    });
    return true;
  }

  /**
   * Single cancellation path for customers (own bookings) and staff (any booking).
   * Releases the slot, refunds Stripe payments, records who/why, notifies the user.
   */
  async cancelBooking(id: string, actor: BookingActor, reason?: string | null) {
    const booking = await prisma.booking.findFirst({
      where: isStaff(actor) ? { id } : { id, userId: actor.id },
      include: { items: true, payment: true },
    });

    if (!booking) throw new AppError('Booking not found', 404);
    assertTransition(booking.status, 'CANCELLED');

    const cancelledBy = isStaff(actor) ? 'staff' : 'customer';
    const cancellationReason = reason?.trim() || null;

    // Refund via Stripe before touching the DB, outside the transaction so a
    // slow/failed Stripe call can't hit the transaction timeout. The idempotency
    // key makes concurrent or retried cancels reuse the same refund, never a second one.
    let refundId: string | undefined;
    if (
      booking.payment?.stripePaymentIntentId &&
      booking.payment.status === 'SUCCEEDED'
    ) {
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: booking.payment.stripePaymentIntentId },
          { idempotencyKey: `refund-booking-${booking.id}` },
        );
        refundId = refund.id;
      } catch (error: any) {
        logger.error(
          `Stripe refund failed for booking ${booking.bookingRef}: ${error?.message}`,
          error,
        );
        throw new AppError(
          `Refund failed: ${error?.message ?? 'payment provider error'}`,
          502,
        );
      }
    }

    const updated = await prisma.$transaction(
      async (tx) => {
        // Conditional update: if a concurrent request already cancelled/completed
        // the booking, this matches nothing and the request gets a 409.
        const cancelled = await this.cancelInTransaction(tx, booking, {
          where: { status: { in: ['PENDING', 'CONFIRMED'] } },
          cancelledById: actor.id,
          reason: cancellationReason,
        });
        if (!cancelled) {
          throw new AppError('Booking has already been cancelled or completed', 409);
        }

        if (refundId && booking.payment) {
          await tx.payment.update({
            where: { id: booking.payment.id },
            data: {
              status: 'REFUNDED',
              refundAmount: booking.payment.amount,
              stripeRefundId: refundId,
            },
          });
        }

        await notificationsService.createBookingCancelled(
          booking,
          { cancelledBy, reason: cancellationReason },
          tx,
        );

        return tx.booking.findUniqueOrThrow({
          where: { id },
          include: {
            items: { include: { slot: { include: { lane: true } } } },
            payment: true,
            user: { select: SAFE_USER_SELECT },
          },
        });
      },
      { timeout: 15000 },
    );

    // Fire-and-forget after commit: a mail failure must not fail the cancel
    void emailService.sendBookingCancellation(id, {
      cancelledBy,
      reason: cancellationReason,
      refunded: Boolean(refundId),
    });

    // An unpaid checkout left open could still be paid from another tab after
    // the booking is cancelled. Close it; failure only needs logging.
    if (
      booking.payment?.stripePaymentIntentId &&
      booking.payment.status !== 'SUCCEEDED'
    ) {
      const intentId = booking.payment.stripePaymentIntentId;
      Promise.resolve()
        .then(() => stripe.paymentIntents.cancel(intentId))
        .catch((error: any) =>
          logger.warn(
            `Could not cancel open payment for booking ${booking.bookingRef}: ${error?.message}`,
          ),
        );
    }

    return updated;
  }

  /**
   * Staff status changes. CANCELLED is routed through cancelBooking so every
   * cancellation releases the slot, refunds and notifies the same way.
   */
  async updateStatus(
    id: string,
    status: BookingStatus,
    actor: BookingActor,
    reason?: string | null,
  ) {
    if (!Object.values(BookingStatus).includes(status)) {
      throw new AppError('Invalid booking status', 400);
    }
    if (status === 'CANCELLED') return this.cancelBooking(id, actor, reason);

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { payment: { select: { status: true } } },
    });
    if (!booking) throw new AppError('Booking not found', 404);
    assertTransition(booking.status, status);

    // CONFIRMED means paid. Staff can only confirm by hand when a verified
    // payment is already recorded (e.g. the Stripe webhook was missed).
    if (status === 'CONFIRMED' && booking.payment?.status !== 'SUCCEEDED') {
      throw new AppError(
        booking.source === 'POS'
          ? 'This booking has not been paid. Record the payment at the POS to confirm it.'
          : 'This booking has not been paid. It is confirmed automatically once the online payment goes through.',
        409,
      );
    }

    const { count } = await prisma.booking.updateMany({
      where: { id, status: booking.status },
      data: { status },
    });
    if (count === 0) {
      throw new AppError('Booking was modified by another request; please refresh', 409);
    }

    if (status === 'CONFIRMED') {
      void notificationsService.notifyBookingConfirmed(booking);
    }

    return prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT }, items: true },
    });
  }
  async deleteBooking(id: string) {
    const booking = await prisma.booking.findFirst({
      where: { id },
      include: {
        items: true,
        payment: true,
      },
    });

    if (!booking) throw new AppError('Booking not found', 404);

    return prisma.$transaction(async (tx) => {
      // Restore slot availability
      const slotIds = booking.items.map((item) => item.slotId);

      await tx.timeSlot.updateMany({
        where: { id: { in: slotIds } },
        data: { isAvailable: true },
      });

      // Delete payment if exists
      if (booking.payment) {
        await tx.payment.delete({
          where: { id: booking.payment.id },
        });
      }

      // Delete booking items first (if not cascade)
      await tx.bookingItem.deleteMany({
        where: { bookingId: booking.id },
      });

      // Finally delete booking
      await tx.booking.delete({
        where: { id },
      });

      return {
        message: 'Booking deleted successfully',
        bookingId: id,
      };
    });
  }
}
