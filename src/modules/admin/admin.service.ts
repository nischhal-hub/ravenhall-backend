import { BookingStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import { buildPaginationMeta, PaginationParams } from "../../utils/pagination";
import {
  BookingStats,
  CustomerSummary,
  DashboardData,
  LaneStats,
  LaneSummary,
  MembershipStats,
  RawLaneRow,
  RawRevenueRow,
  RevenueMonth,
  UserStats,
} from "./dashboard.types";

export class AdminService {
  async getAllBookings(
    pagination: PaginationParams,
    filters: {
      status?: string;
      laneId?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
  ) {
    const where: any = {};
    if (filters.status) where.status = filters.status as BookingStatus;
    if (filters.search) {
      where.OR = [
        { bookingRef: { contains: filters.search, mode: "insensitive" } },
        { user: { email: { contains: filters.search, mode: "insensitive" } } },
        {
          user: {
            firstName: { contains: filters.search, mode: "insensitive" },
          },
        },
      ];
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
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
    name: string;
    type: string;
    description?: string;
    capacity: number;
    hourlyRate: number;
    imageUrl?: string;
  }) {
    return prisma.lane.create({ data: data as any });
  }

  async updateLane(
    id: string,
    data: Partial<{
      name: string;
      type: string;
      description: string;
      capacity: number;
      hourlyRate: number;
      imageUrl: string;
      isActive: boolean;
    }>,
  ) {
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

  async getSlots(filter: {
    date?: string;
    laneId?: string;
    isBlocked?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { date, laneId, isBlocked, search, page = 1, limit = 20 } = filter;

    const skip = (page - 1) * limit;

    const where: Prisma.TimeSlotWhereInput = {
      ...(date && {
        date: new Date(date),
      }),

      ...(laneId && {
        laneId,
      }),

      ...(isBlocked !== undefined && {
        isBlocked,
      }),

      ...(search && {
        lane: {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
      }),
    };

    // Run in transaction (data + count)
    const [slots, total] = await prisma.$transaction([
      prisma.timeSlot.findMany({
        where,
        skip,
        take: limit,
        include: {
          lane: {
            select: {
              name: true,
              type: true,
            },
          },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      }),

      prisma.timeSlot.count({ where }),
    ]);

    return {
      data: slots,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
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
          gte: from
            ? new Date(from)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          lte: to ? new Date(to) : new Date(),
        },
      },
      select: { finalAmount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // ---------------------------
    // Helper: get group key
    // ---------------------------
    const getKey = (date: Date) => {
      const d = new Date(date);

      const year = d.getFullYear();
      const month = d.getMonth(); // 0-based
      const day = d.getDate();

      if (groupBy === "year") {
        return `${year}`;
      }

      if (groupBy === "month") {
        return `${year}-${String(month + 1).padStart(2, "0")}`;
      }

      if (groupBy === "week") {
        // ISO week calculation (simple version)
        const firstJan = new Date(d.getFullYear(), 0, 1);
        const days = Math.floor(
          (d.getTime() - firstJan.getTime()) / (24 * 60 * 60 * 1000),
        );
        const week = Math.ceil((days + firstJan.getDay() + 1) / 7);
        return `${year}-W${week}`;
      }

      // default: day
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };

    // ---------------------------
    // Grouping
    // ---------------------------
    const grouped: Record<string, { total: number; count: number }> = {};

    for (const b of bookings) {
      const key = getKey(b.createdAt);

      if (!grouped[key]) {
        grouped[key] = { total: 0, count: 0 };
      }

      grouped[key].total += b.finalAmount;
      grouped[key].count += 1;
    }

    // ---------------------------
    // Format response
    // ---------------------------
    const result = Object.entries(grouped).map(([key, value]) => ({
      period: key,
      total: value.total,
      count: value.count,
    }));

    const grandTotal = bookings.reduce((sum, b) => sum + b.finalAmount, 0);

    return {
      groupBy,
      total: grandTotal,
      count: bookings.length,
      data: result,
    };
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
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isEmailVerified: true,
          createdAt: true,
          membership: true,
          _count: { select: { bookings: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async updateUserRole(id: string, role: Role) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError("User not found", 404);
    return prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
  }

  async createDiscountCode(data: {
    code: string;
    description?: string;
    discountPct: number;
    maxUses?: number;
    validFrom: string;
    validTo: string;
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
    data: Partial<{
      description: string;
      discountPct: number;
      isActive: boolean;
      maxUses: number;
    }>,
  ) {
    return prisma.discountCode.update({ where: { id }, data });
  }
  async deleteDiscountCode(id: string) {
    return prisma.discountCode.delete({
      where: { id },
    });
  }
  async getDashboardData(): Promise<DashboardData> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

      const [
        totalUsers,
        usersByRole,
        newUsersThisMonth,
        bookingsByStatus,
        totalLanes,
        activeLanes,
        lanesByType,
        activeMembershipsByPlan,
        revenueTimelineRows,
        mostBookedLanesRaw,
        topSpenders,
      ] = await Promise.all([
        // Users
        prisma.user.count(),
        prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
        prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),

        // Bookings Stats
        prisma.booking.groupBy({
          by: ["status"],
          _count: { id: true },
          _sum: { finalAmount: true },
        }),

        // Lanes
        prisma.lane.count(),
        prisma.lane.count({ where: { isActive: true } }),
        prisma.lane.groupBy({ by: ["type"], _count: { id: true } }),

        // Memberships
        prisma.membership.groupBy({
          by: ["plan"],
          _count: { id: true },
          where: { isActive: true },
        }),

        // Revenue Timeline (Last 6 months)
        prisma.$queryRaw<RawRevenueRow[]>`
          SELECT
            DATE_TRUNC('month', b."createdAt") AS month,
            COUNT(DISTINCT b.id)::int AS bookings,
            COALESCE(SUM(b."finalAmount"), 0)::numeric AS revenue
          FROM "Booking" b
          WHERE b.status IN ('CONFIRMED', 'COMPLETED')
            AND b."createdAt" >= ${sixMonthsAgo}
          GROUP BY month
          ORDER BY month ASC
        `,

        // Most Booked Lanes
        prisma.$queryRaw<RawLaneRow[]>`
          SELECT
            l.id AS "laneId",
            l.name AS "laneName",
            l.type::text AS "laneType",
            COUNT(DISTINCT bi.id)::int AS bookings,
            COALESCE(SUM(bi.subtotal), 0)::numeric AS revenue
          FROM "BookingItem" bi
          JOIN "TimeSlot" ts ON bi."slotId" = ts.id
          JOIN "Lane" l ON ts."laneId" = l.id
          JOIN "Booking" b ON bi."bookingId" = b.id
          WHERE b.status IN ('CONFIRMED', 'COMPLETED')
          GROUP BY l.id, l.name, l.type
          ORDER BY bookings DESC
          LIMIT 5
        `,

        // Top Customers
        prisma.booking.groupBy({
          by: ["userId"],
          _sum: { finalAmount: true },
          _count: { id: true },
          where: {
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
          },
          orderBy: { _sum: { finalAmount: "desc" } },
          take: 5,
        }),
      ]);

      // Enrich top customers with user details
      const topSpenderUserIds = topSpenders.map((s) => s.userId);
      const spenderUsers = await prisma.user.findMany({
        where: { id: { in: topSpenderUserIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });

      const spenderMap = new Map(spenderUsers.map((u) => [u.id, u]));

      // ── Build User Stats ─────────────────────────────────────
      const roleMap = usersByRole.reduce<Record<string, number>>((acc, r) => {
        acc[r.role] = r._count.id;
        return acc;
      }, {});

      const userStats: UserStats = {
        total: totalUsers,
        customers: roleMap["CUSTOMER"] ?? 0,
        staff: roleMap["STAFF"] ?? 0,
        admins: roleMap["ADMIN"] ?? 0,
        newThisMonth: newUsersThisMonth,
      };

      // ── Build Booking Stats ──────────────────────────────────
      const statusMap = bookingsByStatus.reduce<
        Record<string, { count: number; revenue: number }>
      >((acc, s) => {
        acc[s.status] = {
          count: s._count.id,
          revenue: s._sum.finalAmount ?? 0,
        };
        return acc;
      }, {});

      const paidRevenue =
        (statusMap["CONFIRMED"]?.revenue ?? 0) +
        (statusMap["COMPLETED"]?.revenue ?? 0);

      const paidCount =
        (statusMap["CONFIRMED"]?.count ?? 0) +
        (statusMap["COMPLETED"]?.count ?? 0);

      const bookingStats: BookingStats = {
        total: bookingsByStatus.reduce((sum, s) => sum + s._count.id, 0),
        confirmed: statusMap["CONFIRMED"]?.count ?? 0,
        completed: statusMap["COMPLETED"]?.count ?? 0,
        cancelled: statusMap["CANCELLED"]?.count ?? 0,
        pending: statusMap["PENDING"]?.count ?? 0,
        totalRevenue: paidRevenue,
        avgRevenuePerBooking: paidCount > 0 ? paidRevenue / paidCount : 0,
      };

      // ── Build Lane Stats ─────────────────────────────────────
      const laneTypeMap = lanesByType.reduce<Record<string, number>>(
        (acc, l) => {
          acc[l.type] = l._count.id;
          return acc;
        },
        {},
      );

      const laneStats: LaneStats = {
        total: totalLanes,
        active: activeLanes,
        inactive: totalLanes - activeLanes,
        byType: laneTypeMap,
      };

      // ── Build Membership Stats ───────────────────────────────
      const planMap = activeMembershipsByPlan.reduce<Record<string, number>>(
        (acc, m) => {
          acc[m.plan] = m._count.id;
          return acc;
        },
        {},
      );

      const membershipStats: MembershipStats = {
        total: activeMembershipsByPlan.reduce((sum, m) => sum + m._count.id, 0),
        casual: planMap["CASUAL"] ?? 0,
        monthly: planMap["MONTHLY"] ?? 0,
        annual: planMap["ANNUAL"] ?? 0,
      };

      // ── Revenue Timeline ─────────────────────────────────────
      const revenueTimeline: RevenueMonth[] = revenueTimelineRows.map((r) => ({
        month: r.month.toISOString(),
        bookings: Number(r.bookings),
        revenue: parseFloat(r.revenue),
      }));

      // ── Most Booked Lanes ────────────────────────────────────
      const mostBookedLanes: LaneSummary[] = mostBookedLanesRaw.map((r) => ({
        laneId: r.laneId,
        laneName: r.laneName,
        laneType: r.laneType,
        bookings: r.bookings,
        revenue: parseFloat(r.revenue),
      }));

      // ── Top Customers ────────────────────────────────────────
      const topCustomers: CustomerSummary[] = topSpenders
        .map((s) => {
          const user = spenderMap.get(s.userId);
          if (!user) return null;
          return {
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            totalSpent: s._sum.finalAmount ?? 0,
            bookings: s._count.id,
          };
        })
        .filter((c): c is CustomerSummary => c !== null);

      return {
        userStats,
        bookingStats,
        laneStats,
        membershipStats,
        revenueTimeline,
        mostBookedLanes,
        topCustomers,
      } as DashboardData;
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      throw new AppError("Failed to load dashboard data", 500);
    }
  }
}
