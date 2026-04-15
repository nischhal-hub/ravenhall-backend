import cron from "node-cron";
import { prisma } from "../config/database";
import { logger } from "../config/logger";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toUtcStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

const OPENING_HOUR = 7; // 7:00 AM
const CLOSING_HOUR = 22; // 10:00 PM
const SLOT_DURATION = 60; // 60 minutes
const DAYS_AHEAD = 30; // Generate slots 30 days in advance

async function generateSlotsForDate(date: Date) {
  const lanes = await prisma.lane.findMany({ where: { isActive: true } });
  const slots = [];

  for (const lane of lanes) {
    for (let hour = OPENING_HOUR; hour < CLOSING_HOUR; hour++) {
      const startTime = `${String(hour).padStart(2, "0")}:00`;
      const endTime = `${String(hour + 1).padStart(2, "0")}:00`;

      slots.push({
        laneId: lane.id,
        date,
        startTime,
        endTime,
        isAvailable: true,
        isBlocked: false,
      });
    }
  }

  // upsert to avoid duplicates
  for (const slot of slots) {
    await prisma.timeSlot.upsert({
      where: {
        laneId_date_startTime: {
          laneId: slot.laneId,
          date: slot.date,
          startTime: slot.startTime,
        },
      },
      update: {},
      create: slot,
    });
  }
}

export async function generateSlotsForNextNDays(days = DAYS_AHEAD) {
  logger.info(`Generating slots for next ${days} days...`);
  const today = toUtcStartOfDay(new Date());

  for (let i = 0; i < days; i++) {
    const targetDate = addDays(today, i);
    await generateSlotsForDate(targetDate);
  }

  logger.info("Slot generation complete");
}

export function startSlotGenerationCron() {
  // Run at midnight every day
  cron.schedule("0 0 * * *", async () => {
    logger.info("Running nightly slot generation cron job");
    try {
      await generateSlotsForNextNDays(DAYS_AHEAD);
    } catch (error) {
      logger.error("Slot generation cron failed:", error);
    }
  });

  // Generate on startup
  generateSlotsForNextNDays().catch((err) => {
    logger.error("Initial slot generation failed:", err);
  });

  logger.info("Slot generation cron job scheduled (runs daily at midnight)");
}
