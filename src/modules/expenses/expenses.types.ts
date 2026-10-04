import { PaymentMethod } from '@prisma/client';

export interface CreateExpenseCategoryInput {
  name: string;
  description?: string;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  description?: string;
}

export interface CreateExpenseInput {
  title: string;
  amount: number;
  categoryId: string;
  description?: string;
  expenseDate?: string | Date;
  paymentMethod?: PaymentMethod;
  receiptUrl?: string;
  receiptPublicId?: string;
}

export interface UpdateExpenseInput {
  title?: string;
  amount?: number;
  categoryId?: string;
  description?: string;
  expenseDate?: string | Date;
  paymentMethod?: PaymentMethod;
  receiptUrl?: string;
  receiptPublicId?: string;
}

export interface ExpenseFilterParams {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  from?: string;
  to?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface ExpenseSummaryParams {
  from?: string;
  to?: string;
  categoryId?: string;
  groupBy?: 'day' | 'week' | 'month' | 'year';
}
