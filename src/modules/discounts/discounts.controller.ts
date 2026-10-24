import { Response, NextFunction } from 'express';
import { DiscountsService } from './discounts.service';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';

const discountsService = new DiscountsService();

export const validateDiscountCode = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // `amount` (optional): booking total, so the minimum spend can be checked
    const amount = req.body.amount == null ? NaN : Number(req.body.amount);
    const result = await discountsService.validateCode(
      req.body.code,
      Number.isFinite(amount) ? amount : undefined,
    );
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};
