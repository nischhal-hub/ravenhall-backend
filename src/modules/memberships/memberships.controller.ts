import { Request, Response, NextFunction } from "express";
import { MembershipsService } from "./memberships.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { sendSuccess, sendCreated } from "../../utils/apiResponse";

const membershipsService = new MembershipsService();

export const getMembershipPlans = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, membershipsService.getPlans());
  } catch (error) { next(error); }
};

export const getMyMembership = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const membership = await membershipsService.getMyMembership(req.user!.id);
    sendSuccess(res, membership);
  } catch (error) { next(error); }
};

export const subscribeMembership = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const membership = await membershipsService.subscribe(req.user!.id, req.body.plan);
    sendCreated(res, membership, "Membership activated successfully");
  } catch (error) { next(error); }
};
