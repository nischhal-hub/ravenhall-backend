import { LaneType, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';

export class LanesService {
  async getAllLanes(params: {
    page: number;
    limit: number;
    search?: string;
    type?: string;
  }) {
    const { page, limit, search = '', type } = params;

    const skip = (page - 1) * limit;

    const where: Prisma.LaneWhereInput = {
      isActive: true,
      ...(type && { type: type as LaneType }),
      ...(search && {
        name: {
          contains: search,
          mode: 'insensitive',
        },
      }),
    };

    const [lanes, total] = await Promise.all([
      prisma.lane.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),

      prisma.lane.count({ where }),
    ]);

    return {
      lanes,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLaneById(id: string) {
    const lane = await prisma.lane.findUnique({
      where: { id },
      include: { slots: true },
    });
    if (!lane || !lane.isActive) throw new AppError('Lane not found', 404);
    return lane;
  }

  async getSlotsForLane(laneId: string, date?: string) {
    if (!date)
      throw new AppError('Date parameter is required (YYYY-MM-DD)', 400);

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime()))
      throw new AppError('Invalid date format', 400);

    return prisma.timeSlot.findMany({
      where: { laneId, date: parsedDate },
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * Public availability search across all active lanes for one date.
   * Used by the customer chatbot, so it only returns what a customer could
   * book: slots that are free, unblocked and (for today) not yet started.
   */
  async getAvailability(params: { date?: string; type?: string }) {
    const { date, type } = params;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError('Date parameter is required (YYYY-MM-DD)', 400);
    }
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(parsedDate.getTime())) {
      throw new AppError('Invalid date format', 400);
    }
    if (type && !Object.values(LaneType).includes(type as LaneType)) {
      throw new AppError('Invalid lane type', 400);
    }

    // Hide slots that have already started when the date is "today" at the centre.
    const { today, time: nowTime } = centreNow();
    if (date < today) return { date, lanes: [] };
    const onlyFuture = date === today;

    const lanes = await prisma.lane.findMany({
      where: { isActive: true, ...(type && { type: type as LaneType }) },
      orderBy: { name: 'asc' },
      include: {
        slots: {
          where: {
            date: parsedDate,
            isAvailable: true,
            isBlocked: false,
            ...(onlyFuture && { startTime: { gt: nowTime } }),
          },
          orderBy: { startTime: 'asc' },
          select: { id: true, startTime: true, endTime: true },
        },
      },
    });

    return {
      date,
      lanes: lanes
        .filter((lane) => lane.slots.length > 0)
        .map((lane) => ({
          id: lane.id,
          name: lane.name,
          type: lane.type,
          capacity: lane.capacity,
          hourlyRate: lane.hourlyRate,
          slots: lane.slots,
        })),
    };
  }
}

/** Current date (YYYY-MM-DD) and time (HH:mm) in the centre's timezone. */
function centreNow() {
  const timeZone = process.env.CENTRE_TIMEZONE || 'Australia/Perth';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    today: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}
