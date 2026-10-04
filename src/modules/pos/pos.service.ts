import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { BookingSource, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { generateBookingRef } from '../../utils/bookingRef';
import { buildPaginationMeta, PaginationParams } from '../../utils/pagination';
import { EmailService } from '../notifications/email.service';
import { logger } from '../../config/logger';

const emailService = new EmailService();

export interface PosCustomerInput {
  
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface CalculatePriceInput {
  slotIds: string[];
  customerId?: string;
  discountCode?: string;
  customDiscountPct?: number;
  customDiscountAmount?: number;
}

export interface CreatePosBookingInput {
  customerId?: string;
  customer?: PosCustomerInput;
  isGuest?: boolean;
  slotIds: string[];
  paymentMethod: PaymentMethod;
  paymentStatus?: 'SUCCEEDED' | 'PENDING';
  discountCode?: string;
  customDiscountPct?: number;
  customDiscountAmount?: number;
  discountReason?: string;
  notes?: string;
}

export interface PosBookingFilterParams {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  date?: string;
  status?: string;
  paymentMethod?: PaymentMethod;
  bookedById?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export class PosService {
  /**
   * Search registered customers by name, email, or phone number for POS lookup
   */
  async searchCustomers(search: string, limit = 10) {
    const trimmed = search.trim();
    if (!trimmed) {
      return prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          membership: {
            select: {
              plan: true,
              discountPct: true,
              isActive: true,
              endDate: true,
            },
          },
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    return prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        OR: [
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
          { email: { contains: trimmed, mode: 'insensitive' } },
          { phone: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        membership: {
          select: {
            plan: true,
            discountPct: true,
            isActive: true,
            endDate: true,
          },
        },
        _count: { select: { bookings: true } },
      },
      take: limit,
      orderBy: { firstName: 'asc' },
    });
  }

  /**
   * Quick-create a walk-in customer at the counter
   */
  async createWalkInCustomer(data: PosCustomerInput) {
    const email = data.email?.trim() || `walkin_${Date.now()}_${crypto.randomInt(100, 999)}@guest.ravenhall.com`;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new AppError('A customer with this email address already exists', 409);
    }

    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    return prisma.user.create({
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email,
        phone: data.phone?.trim() || null,
        password: hashedPassword,
        isEmailVerified: true,
        role: 'CUSTOMER',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get single customer with membership status & booking history
   */
  async getCustomerById(id: string) {
    const customer = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        membership: {
          select: {
            plan: true,
            discountPct: true,
            isActive: true,
            startDate: true,
            endDate: true,
          },
        },
        bookings: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                slot: {
                  include: { lane: { select: { name: true, type: true } } },
                },
              },
            },
            payment: true,
          },
        },
        _count: { select: { bookings: true } },
        createdAt: true,
      },
    });

    if (!customer) throw new AppError('Customer not found', 404);
    return customer;
  }

  /**
   * Get all active lanes with their slots for a specific date (POS calendar/grid view)
   */
  async getLanesAndSlots(dateStr: string, laneId?: string) {
    const parsedDate = new Date(dateStr);
    if (isNaN(parsedDate.getTime())) {
      throw new AppError('Invalid date format. Expected YYYY-MM-DD', 400);
    }

    const whereLane: Prisma.LaneWhereInput = {
      isActive: true,
      ...(laneId && { id: laneId }),
    };

    const lanes = await prisma.lane.findMany({
      where: whereLane,
      include: {
        slots: {
          where: { date: parsedDate },
          orderBy: { startTime: 'asc' },
          include: {
            bookingItems: {
              include: {
                booking: {
                  select: {
                    id: true,
                    bookingRef: true,
                    status: true,
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                        phone: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return lanes.map((lane) => {
      const totalSlots = lane.slots.length;
      const availableSlots = lane.slots.filter((s) => s.isAvailable && !s.isBlocked).length;
      const bookedSlots = lane.slots.filter((s) => !s.isAvailable && !s.isBlocked).length;
      const blockedSlots = lane.slots.filter((s) => s.isBlocked).length;

      return {
        id: lane.id,
        name: lane.name,
        type: lane.type,
        hourlyRate: lane.hourlyRate,
        capacity: lane.capacity,
        description: lane.description,
        imageUrl: lane.imageUrl,
        stats: {
          totalSlots,
          availableSlots,
          bookedSlots,
          blockedSlots,
        },
        slots: lane.slots.map((s) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          isAvailable: s.isAvailable,
          isBlocked: s.isBlocked,
          currentBooking: s.bookingItems[0]?.booking
            ? {
                bookingRef: s.bookingItems[0].booking.bookingRef,
                status: s.bookingItems[0].booking.status,
                customerName: `${s.bookingItems[0].booking.user.firstName} ${s.bookingItems[0].booking.user.lastName}`,
                customerPhone: s.bookingItems[0].booking.user.phone,
              }
            : null,
        })),
      };
    });
  }

  /**
   * Calculate POS price breakdown in real time for cart / checkout
   */
  async calculatePrice(input: CalculatePriceInput) {
    const { slotIds, customerId, discountCode, customDiscountPct = 0, customDiscountAmount = 0 } = input;

    if (!slotIds || slotIds.length === 0) {
      throw new AppError('At least one slot must be selected', 400);
    }

    const slots = await prisma.timeSlot.findMany({
      where: { id: { in: slotIds } },
      include: { lane: true },
      orderBy: { startTime: 'asc' },
    });

    if (slots.length !== slotIds.length) {
      throw new AppError('One or more selected slots could not be found', 404);
    }

    const unavailableSlots = slots.filter((s) => !s.isAvailable || s.isBlocked);
    if (unavailableSlots.length > 0) {
      const times = unavailableSlots.map((s) => `${s.lane.name} (${s.startTime}-${s.endTime})`).join(', ');
      throw new AppError(`The following slots are not available: ${times}`, 409);
    }

    // Subtotal calculation
    const items = slots.map((s) => ({
      slotId: s.id,
      laneId: s.lane.id,
      laneName: s.lane.name,
      laneType: s.lane.type,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      unitPrice: s.lane.hourlyRate,
      subtotal: s.lane.hourlyRate,
    }));

    const totalAmount = items.reduce((acc, curr) => acc + curr.unitPrice, 0);

    // Membership discount
    let membershipDiscountPct = 0;
    let membershipPlan: string | null = null;

    if (customerId) {
      const membership = await prisma.membership.findFirst({
        where: {
          userId: customerId,
          isActive: true,
          endDate: { gt: new Date() },
        },
      });
      if (membership) {
        membershipDiscountPct = membership.discountPct;
        membershipPlan = membership.plan;
      }
    }

    // Promo / Discount code
    let codeDiscountPct = 0;
    let discountCodeRecord = null;

    if (discountCode) {
      discountCodeRecord = await prisma.discountCode.findUnique({
        where: { code: discountCode.toUpperCase() },
      });

      if (
        discountCodeRecord &&
        discountCodeRecord.isActive &&
        discountCodeRecord.validFrom <= new Date() &&
        discountCodeRecord.validTo >= new Date() &&
        (!discountCodeRecord.maxUses || discountCodeRecord.usedCount < discountCodeRecord.maxUses)
      ) {
        codeDiscountPct = discountCodeRecord.discountPct;
      }
    }

    // Determine highest percentage discount
    const applicablePct = Math.max(membershipDiscountPct, codeDiscountPct, customDiscountPct);
    const pctDiscountAmount = Math.round(((totalAmount * applicablePct) / 100) * 100) / 100;

    // Additional flat discount (staff override)
    const flatDiscountAmount = Math.min(totalAmount - pctDiscountAmount, customDiscountAmount);
    const totalDiscountAmount = Math.min(totalAmount, pctDiscountAmount + flatDiscountAmount);
    const finalAmount = Math.max(0, Math.round((totalAmount - totalDiscountAmount) * 100) / 100);

    return {
      items,
      totalAmount,
      discountBreakdown: {
        membership: {
          plan: membershipPlan,
          discountPct: membershipDiscountPct,
        },
        discountCode: discountCodeRecord
          ? {
              code: discountCodeRecord.code,
              discountPct: discountCodeRecord.discountPct,
            }
          : null,
        customDiscount: {
          pct: customDiscountPct,
          amount: customDiscountAmount,
        },
        appliedPct: applicablePct,
        pctDiscountAmount,
        flatDiscountAmount,
        totalDiscountAmount,
      },
      finalAmount,
      discountCodeRecord,
    };
  }

  /**
   * Helper: Resolve or create customer for POS booking
   */
  private async resolveCustomer(input: {
    customerId?: string;
    customer?: PosCustomerInput;
    isGuest?: boolean;
  }) {
    if (input.customerId) {
      const user = await prisma.user.findUnique({
        where: { id: input.customerId },
      });
      if (!user) throw new AppError('Customer not found', 404);
      return user;
    }

    if (input.customer) {
      // Check if user already exists by email if email was provided
      if (input.customer.email?.trim()) {
        const existing = await prisma.user.findUnique({
          where: { email: input.customer.email.trim() },
        });
        if (existing) {
          // If phone was provided and existing didn't have it, update phone
          if (input.customer.phone && !existing.phone) {
            await prisma.user.update({
              where: { id: existing.id },
              data: { phone: input.customer.phone.trim() },
            });
          }
          return existing;
        }
      }

      return this.createWalkInCustomer(input.customer);
    }

    if (input.isGuest) {
      // Create guest customer record
      const guestEmail = `guest_${Date.now()}_${crypto.randomInt(100, 999)}@guest.ravenhall.com`;
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      return prisma.user.create({
        data: {
          firstName: 'Walk-in',
          lastName: 'Guest',
          email: guestEmail,
          password: hashedPassword,
          isEmailVerified: true,
          role: 'CUSTOMER',
        },
      });
    }

    throw new AppError('Customer identification required for booking', 400);
  }

  /**
   * Create walk-in ground booking via POS
   */
  async createPosBooking(staffUserId: string, input: CreatePosBookingInput) {
    const {
      slotIds,
      paymentMethod,
      paymentStatus = 'SUCCEEDED',
      discountCode,
      customDiscountPct,
      customDiscountAmount,
      discountReason,
      notes,
    } = input;

    // 1. Resolve customer
    const customer = await this.resolveCustomer({
      customerId: input.customerId,
      customer: input.customer,
      isGuest: input.isGuest,
    });

    // 2. Calculate pricing & validate slots
    const calculation = await this.calculatePrice({
      slotIds,
      customerId: customer.id,
      discountCode,
      customDiscountPct,
      customDiscountAmount,
    });

    const bookingRef = generateBookingRef();
    const finalBookingStatus = paymentStatus === 'PENDING' ? 'PENDING' : 'CONFIRMED';
    const isPaid = paymentStatus === 'SUCCEEDED';

    // Build notes string
    const noteParts: string[] = [];
    if (notes?.trim()) noteParts.push(notes.trim());
    if (discountReason?.trim()) noteParts.push(`Discount Reason: ${discountReason.trim()}`);
    noteParts.push(`POS Booking [${paymentMethod}]`);
    const fullNotes = noteParts.join(' | ');

    // 3. Atomic Database Transaction
    const bookingId = await prisma.$transaction(
      async (tx) => {
        // Re-check slot availability inside transaction
        const freshSlots = await tx.timeSlot.findMany({
          where: { id: { in: slotIds } },
          select: { id: true, isAvailable: true, isBlocked: true },
        });

        const unavailable = freshSlots.filter((s) => !s.isAvailable || s.isBlocked);
        if (unavailable.length > 0) {
          throw new AppError('One or more selected slots are no longer available', 409);
        }

        // Create booking
        const booking = await tx.booking.create({
          data: {
            bookingRef,
            userId: customer.id,
            status: finalBookingStatus,
            totalAmount: calculation.totalAmount,
            discountAmount: calculation.discountBreakdown.totalDiscountAmount,
            finalAmount: calculation.finalAmount,
            notes: fullNotes,
            discountCodeId: calculation.discountCodeRecord?.id,
            source: BookingSource.POS,
            bookedById: staffUserId,
            items: {
              create: calculation.items.map((item) => ({
                slotId: item.slotId,
                unitPrice: item.unitPrice,
                subtotal: item.unitPrice,
              })),
            },
          },
        });

        // Mark slots as unavailable
        await tx.timeSlot.updateMany({
          where: { id: { in: slotIds } },
          data: { isAvailable: false },
        });

        // Increment discount code usage if applicable
        if (calculation.discountCodeRecord) {
          await tx.discountCode.update({
            where: { id: calculation.discountCodeRecord.id },
            data: { usedCount: { increment: 1 } },
          });
        }

        // Record payment
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            paymentMethod,
            amount: calculation.finalAmount,
            currency: 'aud',
            status: isPaid ? PaymentStatus.SUCCEEDED : PaymentStatus.PENDING,
            paidAt: isPaid ? new Date() : null,
          },
        });

        return booking.id;
      },
      { timeout: 15000 }
    );

    // 4. Fetch full booking details after transaction
    const fullBooking = await this.getPosBookingById(bookingId);

    // 5. Send confirmation email if customer has a valid (non-guest) email
    if (customer.email && !customer.email.endsWith('@guest.ravenhall.com') && isPaid) {
      emailService.sendBookingConfirmation(fullBooking).catch((err) => {
        logger.warn(`Could not send POS booking confirmation email to ${customer.email}:`, err);
      });
    }

    return fullBooking;
  }

  /**
   * Get single POS booking by ID
   */
  async getPosBookingById(id: string) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        bookedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
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
    });

    if (!booking) throw new AppError('Booking not found', 404);
    return booking;
  }

  /**
   * List POS Bookings with comprehensive filtering
   */
  async getPosBookings(params: PosBookingFilterParams) {
    const {
      page,
      limit,
      skip,
      search,
      date,
      status,
      paymentMethod,
      bookedById,
      sortBy = 'createdAt',
      order = 'desc',
    } = params;

    const where: Prisma.BookingWhereInput = {
      source: BookingSource.POS,
      ...(status && { status: status as any }),
      ...(bookedById && { bookedById }),
      ...(paymentMethod && {
        payment: { paymentMethod },
      }),
      ...(date && {
        createdAt: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`),
        },
      }),
      ...(search && {
        OR: [
          { bookingRef: { contains: search, mode: 'insensitive' } },
          { user: { firstName: { contains: search, mode: 'insensitive' } } },
          { user: { lastName: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { phone: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          bookedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            include: {
              slot: {
                include: { lane: { select: { id: true, name: true, type: true } } },
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
   * Get formatted receipt for thermal printing / counter receipt
   */
  async getPosReceipt(bookingId: string) {
    const booking = await this.getPosBookingById(bookingId);

    const items = booking.items.map((item) => ({
      laneName: item.slot.lane.name,
      laneType: item.slot.lane.type,
      date: item.slot.date.toISOString().split('T')[0],
      time: `${item.slot.startTime} - ${item.slot.endTime}`,
      rate: item.unitPrice,
      amount: item.subtotal,
    }));

    const isGuest = booking.user.email.endsWith('@guest.ravenhall.com');

    return {
      receiptNumber: booking.bookingRef,
      bookingId: booking.id,
      issuedAt: booking.createdAt,
      cashier: booking.bookedBy
        ? `${booking.bookedBy.firstName} ${booking.bookedBy.lastName}`
        : 'Counter Staff',
      customer: {
        id: booking.user.id,
        name: `${booking.user.firstName} ${booking.user.lastName}`,
        email: isGuest ? null : booking.user.email,
        phone: booking.user.phone || null,
        isGuest,
      },
      items,
      pricing: {
        subtotal: booking.totalAmount,
        discount: booking.discountAmount,
        discountCode: booking.discountCode?.code || null,
        total: booking.finalAmount,
        currency: 'AUD',
      },
      payment: booking.payment
        ? {
            method: booking.payment.paymentMethod,
            status: booking.payment.status,
            paidAt: booking.payment.paidAt,
            amountPaid: booking.payment.amount,
          }
        : null,
      bookingStatus: booking.status,
      notes: booking.notes,
      venue: {
        name: 'Ravenhall Indoor Cricket Centre',
        address: 'Ravenhall, VIC 3023, Australia',
        phone: '+61 3 0000 0000',
        email: 'info@ravenhallcricket.com.au',
      },
    };
  }

  /**
   * Mark a PENDING walk-in booking as paid (e.g. customer finishes session and pays cash at counter)
   */
  async completePayment(
    bookingId: string,
    data: { paymentMethod: PaymentMethod; amount?: number; notes?: string }
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true, user: true },
    });

    if (!booking) throw new AppError('Booking not found', 404);
    if (booking.status === 'CANCELLED') {
      throw new AppError('Cannot pay for a cancelled booking', 400);
    }
    if (booking.payment?.status === 'SUCCEEDED' && booking.status === 'CONFIRMED') {
      throw new AppError('This booking is already paid and confirmed', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Update or create payment
      if (booking.payment) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: {
            paymentMethod: data.paymentMethod,
            amount: data.amount !== undefined ? data.amount : booking.finalAmount,
            status: PaymentStatus.SUCCEEDED,
            paidAt: new Date(),
          },
        });
      } else {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            paymentMethod: data.paymentMethod,
            amount: data.amount !== undefined ? data.amount : booking.finalAmount,
            status: PaymentStatus.SUCCEEDED,
            paidAt: new Date(),
          },
        });
      }

      // Update booking status
      return tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CONFIRMED',
          notes: data.notes
            ? `${booking.notes ? `${booking.notes} | ` : ''}Payment completed: ${data.paymentMethod} (${data.notes})`
            : booking.notes,
        },
        include: {
          user: true,
          items: { include: { slot: { include: { lane: true } } } },
          payment: true,
          bookedBy: true,
        },
      });
    });

    // Send confirmation email
    if (booking.user.email && !booking.user.email.endsWith('@guest.ravenhall.com')) {
      emailService.sendBookingConfirmation(updated).catch((err) => {
        logger.warn(`Could not send confirmation email:`, err);
      });
    }

    return updated;
  }
}
