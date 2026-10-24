import { DiscountCode, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';

type Db = Prisma.TransactionClient | typeof prisma;

export type DiscountCheck =
  | { valid: true; record: DiscountCode }
  | { valid: false; message: string };

/**
 * The one set of rules for whether a code can be used: exists, active, inside
 * its date range, under its usage limit and, when `bookingAmount` is given,
 * at or above its minimum spend. Codes are stored upper-case.
 */
export async function checkDiscountCode(
  code: string,
  bookingAmount?: number,
  db: Db = prisma,
): Promise<DiscountCheck> {
  const record = await db.discountCode.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
  const now = new Date();

  if (!record || !record.isActive) {
    return { valid: false, message: 'Invalid discount code' };
  }
  if (record.validFrom > now) {
    return { valid: false, message: 'This discount code is not active yet' };
  }
  if (record.validTo < now) {
    return { valid: false, message: 'This discount code has expired' };
  }
  if (record.maxUses !== null && record.usedCount >= record.maxUses) {
    return { valid: false, message: 'This discount code has reached its usage limit' };
  }
  if (
    bookingAmount !== undefined &&
    record.minBookingAmount !== null &&
    bookingAmount < record.minBookingAmount
  ) {
    return {
      valid: false,
      message: `This code needs a booking of at least $${record.minBookingAmount.toFixed(2)}`,
    };
  }
  return { valid: true, record };
}

/**
 * Counts one use of a code. The usage limit is re-checked in the same
 * statement, so two bookings racing for the last use can't both get it.
 */
export async function claimDiscountUse(db: Db, record: DiscountCode) {
  const { count } = await db.discountCode.updateMany({
    where: {
      id: record.id,
      isActive: true,
      ...(record.maxUses !== null && { usedCount: { lt: record.maxUses } }),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (count === 0) {
    throw new AppError('This discount code has reached its usage limit', 409);
  }
}

export class DiscountsService {
  async validateCode(code: string, bookingAmount?: number) {
    const check = await checkDiscountCode(code ?? '', bookingAmount);

    if (!check.valid) {
      return { valid: false, message: check.message, discountPct: 0 };
    }

    return {
      valid: true,
      message: `${check.record.discountPct}% discount applied`,
      discountPct: check.record.discountPct,
      minBookingAmount: check.record.minBookingAmount,
    };
  }
}
