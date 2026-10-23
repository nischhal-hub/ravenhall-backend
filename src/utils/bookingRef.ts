import { businessClock } from "./businessTime";

/**
 * Generates a booking reference in the format RIC-YYYY-XXXXX
 * e.g. RIC-2026-00847
 */
export const generateBookingRef = (): string => {
  // Year at the centre, not on the server
  const { year } = businessClock();
  const random = Math.floor(10000 + Math.random() * 90000);
  return `RIC-${year}-${random}`;
};
