import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { RemindersService } from "../notifications/reminders.service";
import { BookingExpiryService } from "../bookings/booking-expiry.service";

const remindersService = new RemindersService();
const expiryService = new BookingExpiryService();

export type JobOutcome<T> = { status: "ok"; result: T } | { status: "error"; error: string };

/**
 * The single entry point for scheduled work. Every task in it is idempotent,
 * so overlapping runs, retries and several instances are all safe.
 */
export class JobsService {
  async runAll(now = new Date()) {
    // Run in sequence: a failure in one task never skips the other
    const reminders = await this.track("booking-reminders", () =>
      remindersService.runBookingReminders(now),
    );
    const unpaidExpiry = await this.track("unpaid-hold-expiry", () =>
      expiryService.runUnpaidExpiry(now),
    );
    return { ranAt: now.toISOString(), reminders, unpaidExpiry };
  }

  async runReminders(now = new Date()) {
    return this.track("booking-reminders", () => remindersService.runBookingReminders(now));
  }

  /** Last run of each job, for checking the scheduler is alive */
  async getStatus() {
    return prisma.jobRun.findMany({ orderBy: { name: "asc" } });
  }

  private async track<T>(name: string, task: () => Promise<T>): Promise<JobOutcome<T>> {
    const startedAt = new Date();
    await this.record(name, {
      create: { name, lastStartedAt: startedAt, lastStatus: "running", runCount: 1 },
      update: { lastStartedAt: startedAt, lastStatus: "running", runCount: { increment: 1 } },
    });

    try {
      const result = await task();
      const finishedAt = new Date();
      await this.record(name, {
        update: {
          lastFinishedAt: finishedAt,
          lastStatus: "ok",
          lastResult: result as Prisma.InputJsonValue,
          lastError: null,
        },
      });
      logger.info(`[jobs] ${name} ok in ${finishedAt.getTime() - startedAt.getTime()}ms`);
      return { status: "ok", result };
    } catch (error: any) {
      const message = error?.message ?? String(error);
      await this.record(name, {
        update: { lastFinishedAt: new Date(), lastStatus: "error", lastError: message },
      });
      logger.error(`[jobs] ${name} failed:`, error);
      return { status: "error", error: message };
    }
  }

  /**
   * Best effort: the run log must never stop the work itself (e.g. the
   * JobRun table hasn't been migrated yet on some database).
   */
  private async record(
    name: string,
    data: { create?: Prisma.JobRunCreateInput; update: Prisma.JobRunUpdateInput },
  ) {
    try {
      if (data.create) {
        await prisma.jobRun.upsert({ where: { name }, create: data.create, update: data.update });
      } else {
        await prisma.jobRun.update({ where: { name }, data: data.update });
      }
    } catch (error) {
      logger.warn(`[jobs] could not record run of ${name}: ${(error as Error).message}`);
    }
  }
}
