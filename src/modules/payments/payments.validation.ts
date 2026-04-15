import { z } from "zod";

export const createPaymentIntentSchema = z.object({
  body: z.object({
    bookingId: z.string().min(1, "Booking ID is required"),
  }),
});
