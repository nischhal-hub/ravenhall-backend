import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { generateBookingRef } from '../../utils/bookingRef';
import { buildPaginationMeta, PaginationParams } from '../../utils/pagination';
import { stripe } from '../../config/stripe';
import { EmailService } from '../notifications/email.service';
import { Prisma } from '@prisma/client';

const emailService = new EmailService();

export class BookingsService {
  async createBooking(
    userId: string,
    data: { slotId: string; discountCode?: string },
  ) {
    return prisma.$transaction(async (tx) => {
      // Lock the slot row to prevent race conditions
      const slot = await tx.timeSlot.findUnique({
        where: { id: data.slotId },
        include: { lane: true },
      });

      if (!slot) throw new AppError('Time slot not found', 404);
      if (!slot.isAvailable || slot.isBlocked) {
        throw new AppError('This slot is no longer available', 409);
      }

      // Check membership discount
      const membership = await tx.membership.findFirst({
        where: { userId, isActive: true, endDate: { gt: new Date() } },
      });

      let discountPct = 0;
      let discountCodeRecord = null;

      // Check discount code
      if (data.discountCode) {
        discountCodeRecord = await tx.discountCode.findUnique({
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

      const unitPrice = slot.lane.hourlyRate;
      const discountAmount = (unitPrice * discountPct) / 100;
      const finalAmount = unitPrice - discountAmount;

      const booking = await tx.booking.create({
        data: {
          bookingRef: generateBookingRef(),
          userId,
          totalAmount: unitPrice,
          discountAmount,
          finalAmount,
          discountCodeId: discountCodeRecord?.id,
          items: {
            create: {
              slotId: slot.id,
              unitPrice,
              subtotal: finalAmount,
            },
          },
        },
        include: { items: { include: { slot: { include: { lane: true } } } } },
      });

      // Mark slot as unavailable
      await tx.timeSlot.update({
        where: { id: slot.id },
        data: { isAvailable: false },
      });

      // Increment discount code usage
      if (discountCodeRecord) {
        await tx.discountCode.update({
          where: { id: discountCodeRecord.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      return booking;
    });
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
  async getMyBookings(userId: string, pagination: PaginationParams) {
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: { userId },
        include: {
          items: { include: { slot: { include: { lane: true } } } },
          payment: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.booking.count({ where: { userId } }),
    ]);

    return {
      bookings,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getBookingById(id: string) {
    const booking = await prisma.booking.findFirst({
      where: { id },
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

    return prisma.$transaction(async (tx) => {
      // Restore slot availability
      const slotIds = booking.items.map((item) => item.slotId);
      await tx.timeSlot.updateMany({
        where: { id: { in: slotIds } },
        data: { isAvailable: true },
      });

      // Process refund if payment exists
      if (
        booking.payment?.stripePaymentIntentId &&
        booking.payment.status === 'SUCCEEDED'
      ) {
        await stripe.refunds.create({
          payment_intent: booking.payment.stripePaymentIntentId,
        });
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { status: 'REFUNDED' },
        });
      }

      const updated = await tx.booking.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: { items: { include: { slot: { include: { lane: true } } } } },
      });

      await emailService.sendBookingCancellation(
        booking.userId,
        booking.bookingRef,
      );
      return updated;
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
