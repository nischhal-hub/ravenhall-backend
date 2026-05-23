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
    // All reads outside the transaction
    const slot = await prisma.timeSlot.findUnique({
      where: { id: data.slotId },
      include: { lane: true },
    });

    if (!slot) throw new AppError('Time slot not found', 404);
    if (!slot.isAvailable || slot.isBlocked) {
      throw new AppError('This slot is no longer available', 409);
    }

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

    const unitPrice = slot.lane.hourlyRate;
    const discountAmount = (unitPrice * discountPct) / 100;
    const finalAmount = unitPrice - discountAmount;

    // Transaction: only fast atomic writes, no includes
    const bookingId = await prisma.$transaction(
      async (tx) => {
        const freshSlot = await tx.timeSlot.findUnique({
          where: { id: data.slotId },
          select: { isAvailable: true, isBlocked: true },
        });

        if (!freshSlot || !freshSlot.isAvailable || freshSlot.isBlocked) {
          throw new AppError('This slot is no longer available', 409);
        }

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
        });

        await tx.timeSlot.update({
          where: { id: slot.id },
          data: { isAvailable: false },
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
      include: { items: { include: { slot: { include: { lane: true } } } } },
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
            totalAmount: newSlot.lane.hourlyRate,
            finalAmount: newSlot.lane.hourlyRate, // Add discount logic later
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
