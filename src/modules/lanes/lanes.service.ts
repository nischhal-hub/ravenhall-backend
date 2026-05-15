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
    const lane = await prisma.lane.findUnique({ where: { id } });
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
}
