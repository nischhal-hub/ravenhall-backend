import { z } from "zod";

export const createPaymentIntentSchema = z.object({
  body: z.object({
    bookingId: z.string().min(1, "Booking ID is required"),
  }),
});

// Same body as POST /bookings: the API derives lane, date and price from the slot
export const startCheckoutSchema = z.object({
  body: z.object({
    slotId: z.string().min(1, "Slot ID is required"),
    duration: z.number().int().min(1).max(3).optional(),
    discountCode: z.string().optional(),
  }),
});

export const confirmCheckoutSchema = z.object({
  body: z.object({
    paymentIntentId: z.string().min(1, "Payment ID is required"),
  }),
});
