import { Router, Request, Response, NextFunction } from "express";
import type { Router as ExpressRouter } from "express";
import { requireCronSecret } from "../../middleware/cronSecret.middleware";
import { sendSuccess } from "../../utils/apiResponse";
import { JobsService } from "./jobs.service";

const jobsService = new JobsService();

const handle =
  (run: () => Promise<unknown>, message: string) =>
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await run(), message);
    } catch (error) {
      next(error);
    }
  };

const runAll = handle(() => jobsService.runAll(), "Scheduled jobs processed");
const runReminders = handle(async () => {
  const outcome = await jobsService.runReminders();
  if (outcome.status === "error") throw new Error(outcome.error);
  return outcome.result;
}, "Booking reminders processed");
const status = handle(() => jobsService.getStatus(), "Last job runs");

const router: ExpressRouter = Router();

// Every route needs CRON_SECRET (no user auth). Vercel Cron sends GET; other
// schedulers may POST.
router.get("/run", requireCronSecret, runAll);
router.post("/run", requireCronSecret, runAll);
router.get("/status", requireCronSecret, status);

// Reminders only; kept so anything already pointed at it keeps working
router.get("/booking-reminders", requireCronSecret, runReminders);
router.post("/booking-reminders", requireCronSecret, runReminders);

export default router;
