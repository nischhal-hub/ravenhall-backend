import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { UserBooking, UserDashboardData } from './types';
import bcrypt from 'bcryptjs';

export class UserService {
  async getDashboard(userId: string): Promise<UserDashboardData> {
    try {
      const [
        user,
        membership,
        totalBookings,
        totalSpent,
        upcomingCount,
        cancelledCount,
        upcomingBookingsRaw,
        recentBookingsRaw,
      ] = await Promise.all([
        // User Info
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        }),

        // Membership
        prisma.membership.findUnique({
          where: { userId },
          select: {
            plan: true,
            isActive: true,
            endDate: true,
            discountPct: true,
          },
        }),

        // Stats
        prisma.booking.count({ where: { userId } }),
        prisma.booking.aggregate({
          where: { userId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
          _sum: { finalAmount: true },
        }),
        prisma.booking.count({
          where: {
            userId,
            status: 'CONFIRMED',
            createdAt: { gte: new Date() },
          },
        }),
        prisma.booking.count({
          where: { userId, status: 'CANCELLED' },
        }),

        // Upcoming Bookings (next 30 days)
        prisma.booking.findMany({
          where: {
            userId,
            status: { in: ['CONFIRMED', 'PENDING'] },
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
          include: {
            items: {
              include: {
                slot: {
                  include: { lane: { select: { name: true, type: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),

        // Recent Bookings (last 10)
        prisma.booking.findMany({
          where: { userId },
          include: {
            items: {
              include: {
                slot: {
                  include: { lane: { select: { name: true, type: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        }),
      ]);

      if (!user) throw new AppError('User not found', 404);

      const formatBooking = (booking: any): UserBooking => ({
        id: booking.id,
        bookingRef: booking.bookingRef,
        status: booking.status,
        finalAmount: booking.finalAmount,
        createdAt: booking.createdAt.toISOString(),
        date: booking.items[0]?.slot?.date
          ? new Date(booking.items[0].slot.date).toISOString().split('T')[0]
          : '',
        items: booking.items.map((item: any) => ({
          laneName: item.slot.lane.name,
          type: item.slot.lane.type,
          date: new Date(item.slot.date).toISOString().split('T')[0],
          startTime: item.slot.startTime,
          endTime: item.slot.endTime,
        })),
      });

      return {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone || undefined,
        },
        membership: membership
          ? {
              plan: membership.plan,
              isActive: membership.isActive,
              endDate: membership.endDate?.toISOString(),
              discountPct: membership.discountPct,
            }
          : null,
        stats: {
          totalBookings,
          totalSpent: totalSpent._sum.finalAmount ?? 0,
          upcomingBookings: upcomingCount,
          cancelledBookings: cancelledCount,
        },
        upcomingBookings: upcomingBookingsRaw.map(formatBooking),
        recentBookings: recentBookingsRaw.map(formatBooking),
      };
    } catch (error) {
      console.error('User Dashboard Error:', error);
      throw new AppError('Failed to fetch dashboard', 500);
    }
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isEmailVerified: true,
        createdAt: true,
        membership: {
          select: {
            plan: true,
            isActive: true,
            endDate: true,
          },
        },
      },
    });

    if (!user) throw new AppError('User not found', 404);

    return user;
  }

  async updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
    },
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isEmailVerified: true,
      },
    });

    return user;
  }

  // Optional: Change Password (Separate for security)
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new AppError('Current password is incorrect', 400);

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password updated successfully' };
  }
}
