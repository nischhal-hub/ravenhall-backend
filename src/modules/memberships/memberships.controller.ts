// import { Request, Response, NextFunction } from "express";
// import { MembershipsService } from "./memberships.service";
// import { AuthRequest } from "../../middleware/auth.middleware";
// import { sendSuccess, sendCreated } from "../../utils/apiResponse";

// const membershipsService = new MembershipsService();

// export const getMembershipPlans = async (_req: Request, res: Response, next: NextFunction) => {
//   try {
//     sendSuccess(res, membershipsService.getPlans());
//   } catch (error) { next(error); }
// };

// export const getMyMembership = async (req: AuthRequest, res: Response, next: NextFunction) => {
//   try {
//     const membership = await membershipsService.getMyMembership(req.user!.id);
//     sendSuccess(res, membership);
//   } catch (error) { next(error); }
// };

// export const subscribeMembership = async (req: AuthRequest, res: Response, next: NextFunction) => {
//   try {
//     const membership = await membershipsService.subscribe(req.user!.id, req.body.plan);
//     sendCreated(res, membership, "Membership activated successfully");
//   } catch (error) { next(error); }
// };

import { Request, Response, NextFunction } from 'express';
import { MembershipsService } from './memberships.service';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendSuccess, sendCreated } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';

const membershipsService = new MembershipsService();

export const getMembershipPlans = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    sendSuccess(res, membershipsService.getPlans());
  } catch (error) {
    next(error);
  }
};

export const getMyMembership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.id) throw new AppError('Unauthorized', 401);

    const membership = await membershipsService.getMyMembership(req.user.id);
    sendSuccess(res, membership);
  } catch (error) {
    next(error);
  }
};

export const createMembershipPaymentIntent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.id) {
      throw new AppError('Unauthorized: User not found', 401);
    }

    const { plan } = req.body;
    if (!plan) {
      throw new AppError('Plan is required', 400);
    }

    const result = await membershipsService.createMembershipPaymentIntent(
      req.user.id,
      plan,
    );

    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const confirmMembershipPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.id) {
      throw new AppError('Unauthorized: User not found', 401);
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      throw new AppError('Payment Intent ID is required', 400);
    }

    const result = await membershipsService.confirmMembershipPayment(
      req.user.id,
      paymentIntentId,
    );

    sendCreated(res, result, 'Membership activated successfully');
  } catch (error) {
    next(error);
  }
};
