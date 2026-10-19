import { z } from "zod";

export const createBookingSchema = z.object({
  body: z.object({
    slotId: z.string().min(1, "Slot ID is required"),
    duration: z.number().int().min(1).max(3).optional(),
    discountCode: z.string().optional(),
  }),
});
