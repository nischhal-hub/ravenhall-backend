import { z } from 'zod';

export const createExpenseCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Category name is required').max(100, 'Name cannot exceed 100 characters'),
    description: z.string().max(500, 'Description cannot exceed 500 characters').optional(),
  }),
});

export const updateExpenseCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Category name cannot be empty').max(100).optional(),
    description: z.string().max(500).optional(),
  }),
});

const positiveAmountSchema = z.preprocess((val) => {
  if (typeof val === 'string') return parseFloat(val);
  return val;
}, z.number({ invalid_type_error: 'Amount must be a valid number' }).positive('Amount must be greater than zero'));

export const createExpenseSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Expense title is required').max(255, 'Title cannot exceed 255 characters'),
    amount: positiveAmountSchema,
    categoryId: z.string().min(1, 'Category ID is required'),
    description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional(),
    expenseDate: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid expense date format (ISO 8601 or YYYY-MM-DD expected)',
      })
      .optional(),
    paymentMethod: z
      .enum(['STRIPE', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'])
      .optional()
      .default('OTHER'),
  }),
});

export const updateExpenseSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title cannot be empty').max(255).optional(),
    amount: z.preprocess((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'string') return parseFloat(val);
      return val;
    }, z.number().positive('Amount must be greater than zero').optional()),
    categoryId: z.string().min(1).optional(),
    description: z.string().max(1000).optional(),
    expenseDate: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: 'Invalid expense date format',
      })
      .optional(),
    paymentMethod: z.enum(['STRIPE', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']).optional(),
  }),
});

export const getExpensesQuerySchema = z.object({
  query: z
    .object({
      page: z.preprocess((val) => (val ? parseInt(val as string, 10) : 1), z.number().int().min(1)).optional(),
      limit: z.preprocess((val) => (val ? parseInt(val as string, 10) : 15), z.number().int().min(1).max(100)).optional(),
      search: z.preprocess((val) => (!val ? undefined : String(val).trim()), z.string().optional()),
      categoryId: z.preprocess((val) => (!val || val === 'ALL' ? undefined : String(val).trim()), z.string().optional()),
      paymentMethod: z.preprocess(
        (val) => (!val || val === 'ALL' ? undefined : String(val).toUpperCase().trim()),
        z.enum(['STRIPE', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']).optional()
      ),
      from: z.preprocess((val) => (!val ? undefined : String(val).trim()), z.string().optional()),
      to: z.preprocess((val) => (!val ? undefined : String(val).trim()), z.string().optional()),
      sortBy: z.enum(['expenseDate', 'amount', 'title', 'createdAt']).optional().default('expenseDate'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    })
    .refine(
      (data) => {
        if (data.from && data.to) {
          const fromDate = new Date(data.from);
          const toDate = new Date(data.to);
          if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return false;
          return fromDate <= toDate;
        }
        return true;
      },
      { message: 'Start date (from) must be earlier than or equal to end date (to)', path: ['from'] }
    ),
});

export const expenseSummaryQuerySchema = z.object({
  query: z
    .object({
      from: z.preprocess((val) => (!val ? undefined : String(val).trim()), z.string().optional()),
      to: z.preprocess((val) => (!val ? undefined : String(val).trim()), z.string().optional()),
      categoryId: z.preprocess((val) => (!val || val === 'ALL' ? undefined : String(val).trim()), z.string().optional()),
      groupBy: z.enum(['day', 'week', 'month', 'year']).optional().default('month'),
    })
    .refine(
      (data) => {
        if (data.from && data.to) {
          const fromDate = new Date(data.from);
          const toDate = new Date(data.to);
          if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return false;
          return fromDate <= toDate;
        }
        return true;
      },
      { message: 'Start date (from) must be earlier than or equal to end date (to)', path: ['from'] }
    ),
});
