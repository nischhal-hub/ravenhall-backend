import { NextFunction, Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { ExpensesService } from './expenses.service';
import { PaymentMethod } from '@prisma/client';

const expensesService = new ExpensesService();

// ── Category Handlers ──────────────────────────────────────────────────────

export const createCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const category = await expensesService.createCategory(req.body);
    sendCreated(res, category, 'Expense category created successfully');
  } catch (error) {
    next(error);
  }
};

export const getCategories = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const categories = await expensesService.getCategories();
    sendSuccess(res, categories);
  } catch (error) {
    next(error);
  }
};

export const getCategoryById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const category = await expensesService.getCategoryById(req.params.id);
    sendSuccess(res, category);
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const category = await expensesService.updateCategory(req.params.id, req.body);
    sendSuccess(res, category, 'Expense category updated successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await expensesService.deleteCategory(req.params.id);
    sendSuccess(res, result, 'Expense category deleted successfully');
  } catch (error) {
    next(error);
  }
};

// ── Expense Handlers ────────────────────────────────────────────────────────

export const createExpense = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const adminUserId = req.user!.id;
    const expense = await expensesService.createExpense(
      adminUserId,
      req.body,
      req.file
    );
    sendCreated(res, expense, 'Expense recorded successfully');
  } catch (error) {
    next(error);
  }
};

export const getExpenses = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const {
      search = '',
      categoryId,
      paymentMethod,
      from,
      to,
      sortBy = 'expenseDate',
      order = 'desc',
    } = req.query;

    const result = await expensesService.getExpenses({
      ...pagination,
      search: search as string,
      categoryId: categoryId as string | undefined,
      paymentMethod: paymentMethod as PaymentMethod | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
      sortBy: sortBy as string,
      order: order as 'asc' | 'desc',
    });

    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const getExpenseById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const expense = await expensesService.getExpenseById(req.params.id);
    sendSuccess(res, expense);
  } catch (error) {
    next(error);
  }
};

export const updateExpense = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const expense = await expensesService.updateExpense(
      req.params.id,
      req.body,
      req.file
    );
    sendSuccess(res, expense, 'Expense updated successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteExpense = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await expensesService.deleteExpense(req.params.id);
    sendSuccess(res, result, 'Expense deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const getExpenseSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { from, to, categoryId, groupBy = 'month' } = req.query;
    const summary = await expensesService.getExpenseSummary({
      from: from as string | undefined,
      to: to as string | undefined,
      categoryId: categoryId as string | undefined,
      groupBy: groupBy as 'day' | 'week' | 'month' | 'year',
    });
    sendSuccess(res, summary);
  } catch (error) {
    next(error);
  }
};
