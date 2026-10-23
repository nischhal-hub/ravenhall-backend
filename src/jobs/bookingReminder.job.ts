import cron from "node-cron";
import { logger } from "../config/logger";
import {
  REMINDER_JOB_INTERVAL_MINUTES,
  RemindersService,
} from "../modules/notifications/reminders.service";

const remindersService = new RemindersService();
let running = false;

/**
 * In-process scheduler for long-running servers (Docker, VM). Opt-in with
 * REMINDER_CRON_ENABLED=true so a dev server pointed at a shared database doesn't
 * start emailing customers. On serverless hosting leave it off and have the
 * host's scheduler call GET /api/internal/jobs/booking-reminders with CRON_SECRET.
 * Running both is safe: the dedupe keys prevent duplicate reminders.
 */
export function startBookingReminderCron() {
  if (process.env.REMINDER_CRON_ENABLED !== "true") {
    logger.info("Booking reminder cron off (set REMINDER_CRON_ENABLED=true to run it in-process)");
    return;
  }

  cron.schedule(`*/${REMINDER_JOB_INTERVAL_MINUTES} * * * *`, async () => {
    // Skip a tick rather than stack runs on this instance; other instances are
    // covered by the database dedupe keys.
    if (running) return;
    running = true;
    try {
      await remindersService.runBookingReminders();
    } catch (error) {
      logger.error("Booking reminder cron failed:", error);
    } finally {
      running = false;
    }
  });

  logger.info(`Booking reminder cron scheduled (every ${REMINDER_JOB_INTERVAL_MINUTES} minutes)`);
}
