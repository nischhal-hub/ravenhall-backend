import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { uploadExpenseReceipt } from '../../middleware/upload.middleware';
import {
  createCategory,
  createExpense,
  deleteCategory,
  deleteExpense,
  getCategories,
  getCategoryById,
  getExpenseById,
  getExpenses,
  getExpenseSummary,
  updateCategory,
  updateExpense,
} from './expenses.controller';
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  expenseSummaryQuerySchema,
  getExpensesQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
} from './expenses.validation';

// ── Expenses Router ────────────────────────────────────────────────────────
export const expenseRouter: ExpressRouter = Router();

expenseRouter.use(authenticate, requireRole('ADMIN'));

expenseRouter.post('/', uploadExpenseReceipt, validate(createExpenseSchema), createExpense);
expenseRouter.get('/', validate(getExpensesQuerySchema), getExpenses);
expenseRouter.get('/summary', validate(expenseSummaryQuerySchema), getExpenseSummary);
expenseRouter.get('/:id', getExpenseById);
expenseRouter.patch('/:id', uploadExpenseReceipt, validate(updateExpenseSchema), updateExpense);
expenseRouter.delete('/:id', deleteExpense);

// ── Expense Categories Router ──────────────────────────────────────────────
export const expenseCategoryRouter: ExpressRouter = Router();

expenseCategoryRouter.use(authenticate, requireRole('ADMIN'));

expenseCategoryRouter.post('/', validate(createExpenseCategorySchema), createCategory);
expenseCategoryRouter.get('/', getCategories);
expenseCategoryRouter.get('/:id', getCategoryById);
expenseCategoryRouter.patch('/:id', validate(updateExpenseCategorySchema), updateCategory);
expenseCategoryRouter.delete('/:id', deleteCategory);

export default expenseRouter;
