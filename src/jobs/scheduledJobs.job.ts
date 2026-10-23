import cron from "node-cron";
import { logger } from "../config/logger";
import { JobsService } from "../modules/jobs/jobs.service";
import { REMINDER_JOB_INTERVAL_MINUTES } from "../modules/notifications/reminders.service";

const jobsService = new JobsService();
let running = false;

/**
 * In-process scheduler for long-running servers (Docker, VM): runs every
 * scheduled task (reminders + unpaid-hold expiry) every 5 minutes.
 *
 * Opt-in with JOBS_CRON_ENABLED=true (REMINDER_CRON_ENABLED=true still works)
 * so a dev server pointed at a shared database doesn't start emailing
 * customers. On serverless hosting leave it off and have the host's scheduler
 * call GET /api/internal/jobs/run with CRON_SECRET. Running both is safe.
 */
export function startScheduledJobsCron() {
  const enabled =
    process.env.JOBS_CRON_ENABLED === "true" || process.env.REMINDER_CRON_ENABLED === "true";
  if (!enabled) {
    logger.info("Scheduled jobs cron off (set JOBS_CRON_ENABLED=true to run it in-process)");
    return;
  }

  cron.schedule(`*/${REMINDER_JOB_INTERVAL_MINUTES} * * * *`, async () => {
    // Skip a tick rather than stack runs on this instance; other instances are
    // covered by conditional updates and dedupe keys.
    if (running) return;
    running = true;
    try {
      await jobsService.runAll();
    } catch (error) {
      logger.error("Scheduled jobs cron failed:", error);
    } finally {
      running = false;
    }
  });

  logger.info(`Scheduled jobs cron running every ${REMINDER_JOB_INTERVAL_MINUTES} minutes`);
}
