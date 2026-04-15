import { z } from "zod";

export const createBookingSchema = z.object({
  body: z.object({
    slotId: z.string().min(1, "Slot ID is required"),
    discountCode: z.string().optional(),
  }),
});
