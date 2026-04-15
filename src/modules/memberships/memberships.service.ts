import { MembershipPlan } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";

const PLANS = {
  CASUAL:  { discountPct: 0,  durationDays: 0   },
  MONTHLY: { discountPct: 10, durationDays: 30  },
  ANNUAL:  { discountPct: 20, durationDays: 365 },
};

export class MembershipsService {
  getPlans() {
    return Object.entries(PLANS).map(([plan, details]) => ({
      plan,
      ...details,
    }));
  }

  async getMyMembership(userId: string) {
    return prisma.membership.findUnique({
      where: { userId },
    });
  }

  async subscribe(userId: string, plan: MembershipPlan) {
    const planDetails = PLANS[plan];
    if (!planDetails) throw new AppError("Invalid membership plan", 400);

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + planDetails.durationDays);

    return prisma.membership.upsert({
      where: { userId },
      update: {
        plan,
        discountPct: planDetails.discountPct,
        startDate,
        endDate,
        isActive: true,
      },
      create: {
        userId,
        plan,
        discountPct: planDetails.discountPct,
        startDate,
        endDate,
      },
    });
  }
}
