import { prisma } from '../../config/database';

export class DiscountsService {
  async validateCode(code: string) {
    const discount = await prisma.discountCode.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (
      !discount ||
      !discount.isActive ||
      discount.validFrom > new Date() ||
      discount.validTo < new Date() ||
      (discount.maxUses !== null && discount.usedCount >= discount.maxUses)
    ) {
      return {
        valid: false,
        message: 'Invalid or expired discount code',
        discountPct: 0,
      };
    }

    return {
      valid: true,
      message: `${discount.discountPct}% discount applied`,
      discountPct: discount.discountPct,
    };
  }
}
