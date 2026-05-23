// import { MembershipPlan } from "@prisma/client";
// import { prisma } from "../../config/database";
// import { AppError } from "../../utils/AppError";

// const PLANS = {
//   CASUAL:  { discountPct: 0,  durationDays: 0   },
//   MONTHLY: { discountPct: 10, durationDays: 30  },
//   ANNUAL:  { discountPct: 20, durationDays: 365 },
// };

// export class MembershipsService {
//   getPlans() {
//     return Object.entries(PLANS).map(([plan, details]) => ({
//       plan,
//       ...details,
//     }));
//   }

//   async getMyMembership(userId: string) {
//     return prisma.membership.findUnique({
//       where: { userId },
//     });
//   }

//   async subscribe(userId: string, plan: MembershipPlan) {
//     const planDetails = PLANS[plan];
//     if (!planDetails) throw new AppError("Invalid membership plan", 400);

//     const startDate = new Date();
//     const endDate = new Date();
//     endDate.setDate(endDate.getDate() + planDetails.durationDays);

//     return prisma.membership.upsert({
//       where: { userId },
//       update: {
//         plan,
//         discountPct: planDetails.discountPct,
//         startDate,
//         endDate,
//         isActive: true,
//       },
//       create: {
//         userId,
//         plan,
//         discountPct: planDetails.discountPct,
//         startDate,
//         endDate,
//       },
//     });
//   }
// }

import { MembershipPlan, PaymentStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PLANS = {
  CASUAL: { discountPct: 0, durationDays: 0, price: 0 },
  MONTHLY: { discountPct: 10, durationDays: 30, price: 29.99 },
  ANNUAL: { discountPct: 20, durationDays: 365, price: 299.99 },
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
      include: { payment: true },
    });
  }

  // Create Payment Intent for Membership
  async createMembershipPaymentIntent(userId: string, plan: MembershipPlan) {
    const planDetails = PLANS[plan];
    if (!planDetails || planDetails.price <= 0) {
      throw new AppError('Invalid or free membership plan', 400);
    }

    const amount = Math.round(planDetails.price * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'aud',
      metadata: { userId, plan, type: 'membership' }, // This is fine for Stripe
    });

    // Create pending payment record (without metadata)
    const payment = await prisma.payment.create({
      data: {
        stripePaymentIntentId: paymentIntent.id,
        amount: planDetails.price,
        currency: 'aud',
        status: PaymentStatus.PENDING,
        // We will store plan in Stripe metadata only for now
      },
    });

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentId: payment.id,
    };
  }

  // Confirm Payment + Activate Membership
  async confirmMembershipPayment(userId: string, paymentIntentId: string) {
    if (!userId) throw new AppError('User ID is required', 400);
    if (!paymentIntentId)
      throw new AppError('Payment Intent ID is required', 400);

    const payment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    if (!payment) throw new AppError('Payment not found', 404);
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return { success: true, message: 'Membership already activated' };
    }

    // Retrieve plan from Stripe PaymentIntent metadata (most reliable)
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const plan = paymentIntent.metadata.plan as MembershipPlan;

    if (!plan) {
      throw new AppError('Plan information missing', 400);
    }

    const planDetails = PLANS[plan];
    if (!planDetails) throw new AppError('Invalid plan', 400);

    // Update Payment Status
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
      },
    });

    // Activate / Upsert Membership
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + planDetails.durationDays);

    const membership = await prisma.membership.upsert({
      where: { userId },
      update: {
        plan,
        discountPct: planDetails.discountPct,
        startDate,
        endDate,
        isActive: true,
        payment: { connect: { id: payment.id } },
      },
      create: {
        userId,
        plan,
        discountPct: planDetails.discountPct,
        startDate,
        endDate,
        payment: { connect: { id: payment.id } },
      },
    });

    return { success: true, membership };
  }
}
