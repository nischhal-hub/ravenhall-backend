import { z } from "zod";

export const createBookingSchema = z.object({
  body: z.object({
    slotId: z.string().min(1, "Slot ID is required"),
    duration: z.number().int().min(1).max(3).optional(),
    discountCode: z.string().optional(),
  }),
});

export const cancelBookingSchema = z.object({
  body: z
    .object({
      reason: z.string().trim().max(500, "Reason must be 500 characters or fewer").optional(),
    })
    .optional(),
});
