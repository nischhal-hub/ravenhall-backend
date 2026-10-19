import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { generateBookingRef } from '../../utils/bookingRef';
import { EQUIPMENT_FEE } from '../../utils/pricing';
import { buildPaginationMeta, PaginationParams } from '../../utils/pagination';
import { stripe } from '../../config/stripe';
import { logger } from '../../config/logger';
import { EmailService } from '../notifications/email.service';
import { Prisma, Role } from '@prisma/client';

const emailService = new EmailService();

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

    // A multi-hour session is `duration` back-to-back hourly slots on the same
    // lane and day, starting at the chosen slot.
    const slots = await this.resolveConsecutiveSlots(startSlot, duration);

    const membership = await prisma.membership.findFirst({
      where: { userId, isActive: true, endDate: { gt: new Date() } },
    });

    let discountPct = 0;
    let discountCodeRecord = null;

    if (data.discountCode) {
      discountCodeRecord = await prisma.discountCode.findUnique({
        where: { code: data.discountCode },
      });
      if (
        discountCodeRecord &&
        discountCodeRecord.isActive &&
        discountCodeRecord.validFrom <= new Date() &&
        discountCodeRecord.validTo >= new Date() &&
        (!discountCodeRecord.maxUses ||
          discountCodeRecord.usedCount < discountCodeRecord.maxUses)
      ) {
        discountPct = Math.max(discountPct, discountCodeRecord.discountPct);
      }
    }

    if (membership) {
      discountPct = Math.max(discountPct, membership.discountPct);
    }

    const unitPrice = startSlot.lane.hourlyRate;
    const laneHire = unitPrice * slots.length;
    const totalAmount = laneHire + EQUIPMENT_FEE;
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
          await tx.discountCode.update({
            where: { id: discountCodeRecord.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        return booking.id;
      },
      { timeout: 15000 },
    );

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
          user: true,
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
  async getBookingById(id: string, requester: { id: string; role: Role }) {
    const isStaff = requester.role === 'ADMIN' || requester.role === 'STAFF';
    const booking = await prisma.booking.findFirst({
      where: { id, ...(isStaff ? {} : { userId: requester.id }) },
      include: {
        items: { include: { slot: { include: { lane: true } } } },
        payment: true,
        user: true,
        discountCode: true,
      },
    });
    if (!booking) throw new AppError('Booking not found', 404);
    return booking;
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
          user: true,
        },
      });

      return updatedBooking;
    });
  }
  async cancelBooking(id: string, userId: string) {
    const booking = await prisma.booking.findFirst({
      where: { id, userId },
      include: { items: true, payment: true },
    });

    if (!booking) throw new AppError('Booking not found', 404);
    if (booking.status === 'CANCELLED')
      throw new AppError('Booking already cancelled', 400);
    if (booking.status === 'COMPLETED')
      throw new AppError('Cannot cancel a completed booking', 400);

    // Refund via Stripe before touching the DB, outside the transaction so a
    // slow/failed Stripe call can't hit the transaction timeout.
    let refundId: string | undefined;
    if (
      booking.payment?.stripePaymentIntentId &&
      booking.payment.status === 'SUCCEEDED'
    ) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: booking.payment.stripePaymentIntentId,
        });
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

    const updated = await prisma.$transaction(async (tx) => {
      // Restore slot availability
      const slotIds = booking.items.map((item) => item.slotId);
      await tx.timeSlot.updateMany({
        where: { id: { in: slotIds } },
        data: { isAvailable: true },
      });

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

      return tx.booking.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { items: { include: { slot: { include: { lane: true } } } } },
      });
    }, { timeout: 15000 });

    // Email is best-effort; never fail the cancellation because of it
    try {
      await emailService.sendBookingCancellation(
        booking.userId,
        booking.bookingRef,
      );
    } catch (error) {
      logger.error(
        `Failed to send cancellation email for ${booking.bookingRef}`,
        error,
      );
    }

    return updated;
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
