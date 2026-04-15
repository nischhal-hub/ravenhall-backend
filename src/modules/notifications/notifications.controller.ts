import { Response, NextFunction } from "express";
import { NotificationsService } from "./notifications.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { sendSuccess } from "../../utils/apiResponse";

const notificationsService = new NotificationsService();

export const getMyNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const notifications = await notificationsService.getMyNotifications(req.user!.id);
    sendSuccess(res, notifications);
  } catch (error) { next(error); }
};
