import { z } from 'zod';

const dateRangeRefinement = (data: { from?: string; to?: string }) => {
  if (data.from && data.to) {
    return new Date(data.from) <= new Date(data.to);
  }
  return true;
};

export const revenueReportQuerySchema = z.object({
  query: z.object({
    from: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid start date format' })
      .optional(),
    to: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid end date format' })
      .optional(),
    groupBy: z.enum(['day', 'week', 'month', 'year']).optional().default('day'),
  }).refine(dateRangeRefinement, {
    message: 'Start date (from) must be earlier than or equal to end date (to)',
    path: ['from'],
  }),
});

export const revenueSummaryQuerySchema = z.object({
  query: z.object({
    from: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid start date format' })
      .optional(),
    to: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid end date format' })
      .optional(),
  }).refine(dateRangeRefinement, {
    message: 'Start date (from) must be earlier than or equal to end date (to)',
    path: ['from'],
  }),
});

export const revenueTrendsQuerySchema = z.object({
  query: z.object({
    from: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid start date format' })
      .optional(),
    to: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid end date format' })
      .optional(),
    interval: z.enum(['day', 'week', 'month', 'year']).optional().default('month'),
  }).refine(dateRangeRefinement, {
    message: 'Start date (from) must be earlier than or equal to end date (to)',
    path: ['from'],
  }),
});
