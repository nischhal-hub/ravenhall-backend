import { Router, Request, Response, NextFunction } from "express";
import type { Router as ExpressRouter } from "express";
import { requireCronSecret } from "../../middleware/cronSecret.middleware";
import { sendSuccess } from "../../utils/apiResponse";
import { RemindersService } from "./reminders.service";

const remindersService = new RemindersService();

const runBookingReminders = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await remindersService.runBookingReminders();
    sendSuccess(res, result, "Booking reminders processed");
  } catch (error) {
    next(error);
  }
};

const router: ExpressRouter = Router();

// Called by a host scheduler (Vercel Cron sends GET; other pingers may POST)
router.get("/booking-reminders", requireCronSecret, runBookingReminders);
router.post("/booking-reminders", requireCronSecret, runBookingReminders);

export default router;
