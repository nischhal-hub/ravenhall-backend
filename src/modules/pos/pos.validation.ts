import { z } from 'zod';

export const createPosCustomerSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().min(6, 'Phone number must be at least 6 digits').optional().or(z.literal('')),
  }),
});

export const calculatePosPriceSchema = z.object({
  body: z.object({
    slotIds: z
      .array(z.string().min(1))
      .min(1, 'At least one slot must be selected')
      .optional(),
    slotId: z.string().optional(),
    customerId: z.string().optional(),
    discountCode: z.string().optional(),
    customDiscountPct: z.number().min(0).max(100).optional(),
    customDiscountAmount: z.number().min(0).optional(),
  }).refine(
    (data) => (data.slotIds && data.slotIds.length > 0) || !!data.slotId,
    {
      message: 'Either slotIds (array) or slotId must be provided',
      path: ['slotIds'],
    }
  ),
});

export const createPosBookingSchema = z.object({
  body: z.object({
    // Existing customer OR walk-in customer details OR guest
    customerId: z.string().optional(),
    customer: z
      .object({
        firstName: z.string().min(1, 'First name is required'),
        lastName: z.string().min(1, 'Last name is required'),
        email: z.string().email('Invalid email address').optional().or(z.literal('')),
        phone: z.string().optional(),
      })
      .optional(),
    isGuest: z.boolean().optional(),

    // Slot selection (array of slot IDs or single slotId)
    slotIds: z
      .array(z.string().min(1))
      .min(1, 'At least one slot is required')
      .optional(),
    slotId: z.string().optional(),

    // Payment details
    paymentMethod: z.enum(['CASH', 'CARD', 'STRIPE', 'BANK_TRANSFER', 'OTHER'], {
      required_error: 'Payment method is required (CASH, CARD, STRIPE, BANK_TRANSFER, OTHER)',
    }),
    paymentStatus: z.enum(['SUCCEEDED', 'PENDING']).optional().default('SUCCEEDED'),

    // Discounts
    discountCode: z.string().optional(),
    customDiscountPct: z.number().min(0).max(100).optional(),
    customDiscountAmount: z.number().min(0).optional(),
    discountReason: z.string().optional(),

    // Notes
    notes: z.string().optional(),
  }).refine(
    (data) => (data.slotIds && data.slotIds.length > 0) || !!data.slotId,
    {
      message: 'Either slotIds (array) or slotId must be provided',
      path: ['slotIds'],
    }
  ).refine(
    (data) => !!data.customerId || !!data.customer || data.isGuest === true,
    {
      message: 'Please provide either customerId, customer details, or mark as guest',
      path: ['customerId'],
    }
  ),
});

export const completePosPaymentSchema = z.object({
  body: z.object({
    paymentMethod: z.enum(['CASH', 'CARD', 'STRIPE', 'BANK_TRANSFER', 'OTHER']),
    amount: z.number().min(0).optional(),
    notes: z.string().optional(),
  }),
});

export const getPosSlotsSchema = z.object({
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
    laneId: z.string().optional(),
  }),
});
