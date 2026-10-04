import { Expense, ExpenseCategory, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/AppError';
import { buildPaginationMeta } from '../../utils/pagination';
import {
  deleteImageFromCloudinary,
  uploadImageToCloudinary,
} from '../../utils/cloudinaryUpload';
import {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ExpenseFilterParams,
  ExpenseSummaryParams,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from './expenses.types';

export class ExpensesService {
  /**
   * Seed default categories if table is empty
   */
  async seedDefaultCategoriesIfEmpty(): Promise<void> {
    const count = await prisma.expenseCategory.count();
    if (count > 0) return;

    const defaults = [
      { name: 'Rent', description: 'Office and cricket facility grounds rent', isDefault: true },
      { name: 'Utilities', description: 'Electricity, water, gas, and council services', isDefault: true },
      { name: 'Ground Maintenance', description: 'Pitch preparation, grass cutting, rolling, and turf care', isDefault: true },
      { name: 'Equipment Maintenance', description: 'Bowling machines, nets, mats, balls, and gear repair', isDefault: true },
      { name: 'Salaries & Wages', description: 'Staff salaries, coaching stipends, and contractor fees', isDefault: true },
      { name: 'Office Supplies & IT', description: 'Internet, software subscriptions, stationery, and hardware', isDefault: true },
      { name: 'Marketing & Advertising', description: 'Social media ads, event flyers, banners, and promotions', isDefault: true },
      { name: 'Insurance & Licenses', description: 'Public liability insurance and municipal permits', isDefault: true },
      { name: 'Miscellaneous', description: 'Other operational and unforeseen expenses', isDefault: true },
    ];

    await prisma.expenseCategory.createMany({
      data: defaults,
      skipDuplicates: true,
    });
  }

  // ── Expense Categories ───────────────────────────────────────────────────

  async createCategory(data: CreateExpenseCategoryInput): Promise<ExpenseCategory> {
    const trimmedName = data.name.trim();

    const existing = await prisma.expenseCategory.findUnique({
      where: { name: trimmedName },
    });
    if (existing) {
      throw new AppError(`Category "${trimmedName}" already exists`, 409);
    }

    return prisma.expenseCategory.create({
      data: {
        name: trimmedName,
        description: data.description?.trim() || null,
      },
    });
  }

  async getCategories() {
    await this.seedDefaultCategoriesIfEmpty();

    const categories = await prisma.expenseCategory.findMany({
      include: {
        _count: {
          select: { expenses: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Compute sum of expenses per category
    const sums = await prisma.expense.groupBy({
      by: ['categoryId'],
      _sum: { amount: true },
    });
    const sumMap = new Map<string, number>(
      sums.map((s) => [s.categoryId, Math.round((s._sum.amount ?? 0) * 100) / 100])
    );

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isDefault: c.isDefault,
      expenseCount: c._count.expenses,
      totalSpent: sumMap.get(c.id) || 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async getCategoryById(id: string) {
    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      include: {
        _count: { select: { expenses: true } },
      },
    });
    if (!category) throw new AppError('Expense category not found', 404);

    const sum = await prisma.expense.aggregate({
      where: { categoryId: id },
      _sum: { amount: true },
    });

    return {
      ...category,
      expenseCount: category._count.expenses,
      totalSpent: Math.round((sum._sum.amount ?? 0) * 100) / 100,
    };
  }

  async updateCategory(id: string, data: UpdateExpenseCategoryInput): Promise<ExpenseCategory> {
    const existing = await prisma.expenseCategory.findUnique({ where: { id } });
    if (!existing) throw new AppError('Expense category not found', 404);

    if (data.name && data.name.trim() !== existing.name) {
      const duplicate = await prisma.expenseCategory.findUnique({
        where: { name: data.name.trim() },
      });
      if (duplicate && duplicate.id !== id) {
        throw new AppError(`Category "${data.name.trim()}" already exists`, 409);
      }
    }

    return prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
      },
    });
  }

  async deleteCategory(id: string): Promise<{ message: string; id: string }> {
    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      include: {
        _count: { select: { expenses: true } },
      },
    });

    if (!category) throw new AppError('Expense category not found', 404);

    if (category._count.expenses > 0) {
      throw new AppError(
        `Cannot delete category "${category.name}" because it is currently linked to ${category._count.expenses} expense record(s). Please reassign or delete these expenses first.`,
        400
      );
    }

    await prisma.expenseCategory.delete({ where: { id } });
    return { message: 'Category deleted successfully', id };
  }

  // ── Expenses ─────────────────────────────────────────────────────────────

  async createExpense(
    adminUserId: string,
    data: CreateExpenseInput,
    file?: Express.Multer.File
  ): Promise<Expense> {
    // 1. Verify category exists
    const category = await prisma.expenseCategory.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) throw new AppError('Expense category not found', 404);

    // 2. Validate & round monetary amount
    const roundedAmount = Math.round(data.amount * 100) / 100;
    if (roundedAmount <= 0) {
      throw new AppError('Expense amount must be greater than zero', 400);
    }

    // 3. Handle receipt upload if file provided
    let receiptUrl: string | undefined = data.receiptUrl;
    let receiptPublicId: string | undefined = data.receiptPublicId;

    if (file) {
      const uploadResult = await uploadImageToCloudinary(file.buffer, 'ravenhall/expenses');
      receiptUrl = uploadResult.secureUrl;
      receiptPublicId = uploadResult.publicId;
    }

    // 4. Parse expense date
    let expenseDate = new Date();
    if (data.expenseDate) {
      expenseDate = new Date(data.expenseDate);
      if (isNaN(expenseDate.getTime())) {
        throw new AppError('Invalid expense date', 400);
      }
    }

    return prisma.expense.create({
      data: {
        title: data.title.trim(),
        amount: roundedAmount,
        categoryId: data.categoryId,
        description: data.description?.trim() || null,
        expenseDate,
        paymentMethod: data.paymentMethod || 'OTHER',
        receiptUrl: receiptUrl || null,
        receiptPublicId: receiptPublicId || null,
        createdById: adminUserId,
      },
      include: {
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    });
  }

  async getExpenses(params: ExpenseFilterParams) {
    const {
      page,
      limit,
      skip,
      search,
      categoryId,
      paymentMethod,
      from,
      to,
      sortBy = 'expenseDate',
      order = 'desc',
    } = params;

    const where: Prisma.ExpenseWhereInput = {
      ...(categoryId && { categoryId }),
      ...(paymentMethod && { paymentMethod }),
      ...((from || to) && {
        expenseDate: {
          ...(from && { gte: new Date(from.includes('T') ? from : `${from}T00:00:00.000Z`) }),
          ...(to && { lte: new Date(to.includes('T') ? to : `${to}T23:59:59.999Z`) }),
        },
      }),
      ...(search && {
        OR: [
          { title: { contains: search.trim(), mode: 'insensitive' } },
          { description: { contains: search.trim(), mode: 'insensitive' } },
        ],
      }),
    };

    const [expenses, total, sumAggregate] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          category: true,
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { [sortBy]: order },
        skip,
        take: limit,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    const totalAmount = Math.round((sumAggregate._sum.amount ?? 0) * 100) / 100;

    return {
      expenses,
      totalAmount,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getExpenseById(id: string) {
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    });
    if (!expense) throw new AppError('Expense record not found', 404);
    return expense;
  }

  async updateExpense(
    id: string,
    data: UpdateExpenseInput,
    file?: Express.Multer.File
  ): Promise<Expense> {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError('Expense record not found', 404);

    if (data.categoryId) {
      const category = await prisma.expenseCategory.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) throw new AppError('Expense category not found', 404);
    }

    let roundedAmount: number | undefined;
    if (data.amount !== undefined) {
      roundedAmount = Math.round(data.amount * 100) / 100;
      if (roundedAmount <= 0) {
        throw new AppError('Expense amount must be greater than zero', 400);
      }
    }

    let expenseDate: Date | undefined;
    if (data.expenseDate) {
      expenseDate = new Date(data.expenseDate);
      if (isNaN(expenseDate.getTime())) {
        throw new AppError('Invalid expense date', 400);
      }
    }

    let receiptUrl = existing.receiptUrl;
    let receiptPublicId = existing.receiptPublicId;

    if (file) {
      const uploadResult = await uploadImageToCloudinary(file.buffer, 'ravenhall/expenses');
      if (existing.receiptUrl) {
        await deleteImageFromCloudinary(existing.receiptUrl);
      }
      receiptUrl = uploadResult.secureUrl;
      receiptPublicId = uploadResult.publicId;
    }

    return prisma.expense.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title.trim() }),
        ...(roundedAmount !== undefined && { amount: roundedAmount }),
        ...(data.categoryId && { categoryId: data.categoryId }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(expenseDate && { expenseDate }),
        ...(data.paymentMethod && { paymentMethod: data.paymentMethod }),
        ...(receiptUrl !== undefined && { receiptUrl }),
        ...(receiptPublicId !== undefined && { receiptPublicId }),
      },
      include: {
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    });
  }

  async deleteExpense(id: string): Promise<{ message: string; id: string }> {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError('Expense record not found', 404);

    if (existing.receiptUrl) {
      await deleteImageFromCloudinary(existing.receiptUrl);
    }

    await prisma.expense.delete({ where: { id } });
    return { message: 'Expense deleted successfully', id };
  }

  // ── Expense Summary ──────────────────────────────────────────────────────

  async getExpenseSummary(params: ExpenseSummaryParams) {
    const { from, to, categoryId, groupBy = 'month' } = params;

    const where: Prisma.ExpenseWhereInput = {
      ...(categoryId && { categoryId }),
      ...((from || to) && {
        expenseDate: {
          ...(from && { gte: new Date(from.includes('T') ? from : `${from}T00:00:00.000Z`) }),
          ...(to && { lte: new Date(to.includes('T') ? to : `${to}T23:59:59.999Z`) }),
        },
      }),
    };

    const [totalAggregate, count, expenses, categoryGroups, paymentMethodGroups] = await Promise.all([
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        select: { amount: true, expenseDate: true },
        orderBy: { expenseDate: 'asc' },
      }),
      prisma.expense.groupBy({
        by: ['categoryId'],
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.expense.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const totalExpenses = Math.round((totalAggregate._sum.amount ?? 0) * 100) / 100;

    // Enrich category breakdown
    const categoryIds = categoryGroups.map((g) => g.categoryId);
    const categoryRecords = await prisma.expenseCategory.findMany({
      where: { id: { in: categoryIds } },
    });
    const categoryMap = new Map(categoryRecords.map((c) => [c.id, c.name]));

    const byCategory = categoryGroups.map((g) => {
      const sum = Math.round((g._sum.amount ?? 0) * 100) / 100;
      return {
        categoryId: g.categoryId,
        categoryName: categoryMap.get(g.categoryId) || 'Unknown',
        total: sum,
        count: g._count.id,
        percentage: totalExpenses > 0 ? Math.round((sum / totalExpenses) * 10000) / 100 : 0,
      };
    }).sort((a, b) => b.total - a.total);

    // Enrich payment method breakdown
    const byPaymentMethod = paymentMethodGroups.map((g) => {
      const sum = Math.round((g._sum.amount ?? 0) * 100) / 100;
      return {
        method: g.paymentMethod || 'OTHER',
        total: sum,
        count: g._count.id,
        percentage: totalExpenses > 0 ? Math.round((sum / totalExpenses) * 10000) / 100 : 0,
      };
    }).sort((a, b) => b.total - a.total);

    // Timeline grouping
    const getKey = (date: Date): string => {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const day = d.getDate();

      if (groupBy === 'year') return `${year}`;
      if (groupBy === 'month') return `${year}-${String(month).padStart(2, '0')}`;
      if (groupBy === 'week') {
        const firstJan = new Date(d.getFullYear(), 0, 1);
        const days = Math.floor((d.getTime() - firstJan.getTime()) / (24 * 60 * 60 * 1000));
        const week = Math.ceil((days + firstJan.getDay() + 1) / 7);
        return `${year}-W${String(week).padStart(2, '0')}`;
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    const timelineMap: Record<string, { total: number; count: number }> = {};
    for (const exp of expenses) {
      const key = getKey(exp.expenseDate);
      if (!timelineMap[key]) {
        timelineMap[key] = { total: 0, count: 0 };
      }
      timelineMap[key].total += exp.amount;
      timelineMap[key].count += 1;
    }

    const timeline = Object.entries(timelineMap).map(([period, val]) => ({
      period,
      total: Math.round(val.total * 100) / 100,
      count: val.count,
    }));

    return {
      dateRange: { from: from || null, to: to || null },
      totalExpenses,
      expenseCount: count,
      byCategory,
      byPaymentMethod,
      timeline,
    };
  }
}
