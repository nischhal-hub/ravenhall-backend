import { BookingStatus, Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { buildPaginationMeta, PaginationParams } from "../../utils/pagination";

export class AdminService {
  async getAllBookings(
    pagination: PaginationParams,
    filters: {
      status?: string; laneId?: string;
      dateFrom?: string; dateTo?: string; search?: string;
    }
  ) {
    const where: any = {};
    if (filters.status) where.status = filters.status as BookingStatus;
    if (filters.search) {
      where.OR = [
        { bookingRef: { contains: filters.search, mode: "insensitive" } },
        { user: { email: { contains: filters.search, mode: "insensitive" } } },
        { user: { firstName: { contains: filters.search, mode: "insensitive" } } },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          items: { include: { slot: { include: { lane: true } } } },
          payment: true,
        },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async updateBookingStatus(id: string, status: BookingStatus) {
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new AppError("Booking not found", 404);
    return prisma.booking.update({
      where: { id },
      data: { status },
      include: { user: true, items: true },
    });
  }

  async createLane(data: {
    name: string; type: string; description?: string;
    capacity: number; hourlyRate: number; imageUrl?: string;
  }) {
    return prisma.lane.create({ data: data as any });
  }

  async updateLane(id: string, data: Partial<{
    name: string; type: string; description: string;
    capacity: number; hourlyRate: number; imageUrl: string; isActive: boolean;
  }>) {
    const lane = await prisma.lane.findUnique({ where: { id } });
    if (!lane) throw new AppError("Lane not found", 404);
    return prisma.lane.update({ where: { id }, data: data as any });
  }

  async deleteLane(id: string) {
    const lane = await prisma.lane.findUnique({ where: { id } });
    if (!lane) throw new AppError("Lane not found", 404);
    return prisma.lane.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async blockSlots(slotIds: string[]) {
    await prisma.timeSlot.updateMany({
      where: { id: { in: slotIds } },
      data: { isBlocked: true, isAvailable: false },
    });
  }

  async unblockSlots(slotIds: string[]) {
    await prisma.timeSlot.updateMany({
      where: { id: { in: slotIds } },
      data: { isBlocked: false, isAvailable: true },
    });
  }

  async getRevenueReport(from: string, to: string, groupBy: string) {
    const bookings = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        createdAt: {
          gte: from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          lte: to ? new Date(to) : new Date(),
        },
      },
      select: { finalAmount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const total = bookings.reduce((sum, b) => sum + b.finalAmount, 0);
    const count = bookings.length;

    return { total, count, bookings, groupBy };
  }

  async getAllUsers(pagination: PaginationParams, search?: string) {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          phone: true, role: true, isEmailVerified: true,
          createdAt: true, membership: true,
          _count: { select: { bookings: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async updateUserRole(id: string, role: Role) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError("User not found", 404);
    return prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
  }

  async createDiscountCode(data: {
    code: string; description?: string; discountPct: number;
    maxUses?: number; validFrom: string; validTo: string;
  }) {
    return prisma.discountCode.create({
      data: {
        ...data,
        code: data.code.toUpperCase(),
        validFrom: new Date(data.validFrom),
        validTo: new Date(data.validTo),
      },
    });
  }

  async getAllDiscountCodes() {
    return prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } });
  }

  async updateDiscountCode(
    id: string,
    data: Partial<{ description: string; discountPct: number; isActive: boolean; maxUses: number }>
  ) {
    return prisma.discountCode.update({ where: { id }, data });
  }
}
