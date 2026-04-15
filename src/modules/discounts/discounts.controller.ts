import { Response, NextFunction } from "express";
import { DiscountsService } from "./discounts.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { sendSuccess } from "../../utils/apiResponse";

const discountsService = new DiscountsService();

export const validateDiscountCode = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await discountsService.validateCode(req.body.code);
    sendSuccess(res, result);
  } catch (error) { next(error); }
};
