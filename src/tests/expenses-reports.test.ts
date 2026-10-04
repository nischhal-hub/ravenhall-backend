import request from 'supertest';
import app from '../app';
import { prisma } from '../config/database';
import { generateAccessToken } from '../utils/jwt';
import bcrypt from 'bcryptjs';

jest.setTimeout(45000);

describe('Expenses & Revenue Reporting Module', () => {
  let adminToken: string;
  let customerToken: string;
  let adminUserId: string;
  let customerUserId: string;
  let testCategoryId: string;
  let testCategoryName: string;
  let testExpenseId: string;
  const createdExpenseIds: string[] = [];
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash('Admin@123456', 10);

    // 1. Create or get test admin
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin-expense-test@test-suite.com' },
      update: { role: 'ADMIN' },
      create: {
        email: 'admin-expense-test@test-suite.com',
        firstName: 'Finance',
        lastName: 'Admin',
        password: hashedPassword,
        role: 'ADMIN',
        isEmailVerified: true,
      },
    });
    adminUserId = adminUser.id;
    adminToken = generateAccessToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // 2. Create customer for testing unauthorized access
    const customerUser = await prisma.user.upsert({
      where: { email: 'cust-expense-test@test-suite.com' },
      update: { role: 'CUSTOMER' },
      create: {
        email: 'cust-expense-test@test-suite.com',
        firstName: 'Regular',
        lastName: 'Customer',
        password: hashedPassword,
        role: 'CUSTOMER',
        isEmailVerified: true,
      },
    });
    customerUserId = customerUser.id;
    customerToken = generateAccessToken({
      userId: customerUser.id,
      email: customerUser.email,
      role: customerUser.role,
    });
  }, 45000);

  afterAll(async () => {
    // Clean up created test expenses
    if (createdExpenseIds.length > 0) {
      await prisma.expense.deleteMany({
        where: { id: { in: createdExpenseIds } },
      });
    }

    // Clean up created test categories
    if (createdCategoryIds.length > 0) {
      await prisma.expenseCategory.deleteMany({
        where: { id: { in: createdCategoryIds } },
      });
    }

    // Clean up test users
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['admin-expense-test@test-suite.com', 'cust-expense-test@test-suite.com'],
        },
      },
    });

    await prisma.$disconnect();
  }, 45000);

  // ── 1. Authorization & Role Checks ───────────────────────────────────────
  describe('Authorization & Access Control', () => {
    it('should reject unauthenticated requests to /api/admin/expenses', async () => {
      const res = await request(app).get('/api/admin/expenses');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin (CUSTOMER) access to /api/admin/expenses with 403', async () => {
      const res = await request(app)
        .get('/api/admin/expenses')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });

    it('should reject non-admin (CUSTOMER) access to /api/admin/reports/revenue with 403', async () => {
      const res = await request(app)
        .get('/api/admin/reports/revenue')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ── 2. Expense Category Management ───────────────────────────────────────
  describe('Expense Categories', () => {
    it('should list categories and automatically seed defaults if empty', async () => {
      const res = await request(app)
        .get('/api/admin/expense-categories')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should create a custom expense category', async () => {
      testCategoryName = `Lawn & Grounds Maintenance ${Date.now()}`;
      const res = await request(app)
        .post('/api/admin/expense-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: testCategoryName,
          description: 'Grass cutting, turf rolling, and pitch preparation',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.name).toBe(testCategoryName);

      testCategoryId = res.body.data.id;
      createdCategoryIds.push(testCategoryId);
    });

    it('should reject duplicate category name', async () => {
      const res = await request(app)
        .post('/api/admin/expense-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: testCategoryName,
          description: 'Duplicate',
        });

      expect(res.status).toBe(409);
    });

    it('should update a category description', async () => {
      const res = await request(app)
        .patch(`/api/admin/expense-categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          description: 'Updated groundskeeping & grass maintenance',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Updated groundskeeping & grass maintenance');
    });
  });

  // ── 3. Custom Expense Management ─────────────────────────────────────────
  describe('Custom Expenses Operations', () => {
    it('should reject negative or zero expense amount', async () => {
      const res = await request(app)
        .post('/api/admin/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Invalid Expense',
          amount: -50.0,
          categoryId: testCategoryId,
        });

      expect(res.status).toBe(422);
    });

    it('should reject expense with non-existent categoryId', async () => {
      const res = await request(app)
        .post('/api/admin/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Orphan Expense',
          amount: 150.0,
          categoryId: 'non-existent-cat-id-12345',
        });

      expect(res.status).toBe(404);
    });

    it('should create a custom expense (Grass-cutting and lawn maintenance)', async () => {
      const res = await request(app)
        .post('/api/admin/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Grass-cutting and lawn maintenance charges',
          amount: 250.75,
          categoryId: testCategoryId,
          description: 'Outfield mowing and pitch repair for weekend matches',
          paymentMethod: 'BANK_TRANSFER',
          expenseDate: '2026-10-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.title).toBe('Grass-cutting and lawn maintenance charges');
      expect(res.body.data.amount).toBe(250.75);
      expect(res.body.data.paymentMethod).toBe('BANK_TRANSFER');
      expect(res.body.data.createdById).toBe(adminUserId);

      testExpenseId = res.body.data.id;
      createdExpenseIds.push(testExpenseId);
    });

    it('should prevent deleting category that has associated expenses', async () => {
      const res = await request(app)
        .delete(`/api/admin/expense-categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('expense record');
    });

    it('should retrieve individual expense by ID', async () => {
      const res = await request(app)
        .get(`/api/admin/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testExpenseId);
      expect(res.body.data.category.id).toBe(testCategoryId);
    });

    it('should update an expense', async () => {
      const res = await request(app)
        .patch(`/api/admin/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 275.5,
          description: 'Revised invoice amount for additional rolling',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(275.5);
      expect(res.body.data.description).toBe('Revised invoice amount for additional rolling');
    });

    it('should filter expenses by category and search term', async () => {
      const res = await request(app)
        .get(`/api/admin/expenses?categoryId=${testCategoryId}&search=Grass-cutting`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.expenses.length).toBeGreaterThan(0);
      expect(res.body.data.totalAmount).toBe(275.5);
      expect(res.body.data.meta).toBeDefined();
    });

    it('should reject invalid date range (from > to)', async () => {
      const res = await request(app)
        .get('/api/admin/expenses?from=2026-12-31&to=2026-01-01')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
    });

    it('should retrieve expense summary', async () => {
      const res = await request(app)
        .get(`/api/admin/expenses/summary?categoryId=${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalExpenses).toBeGreaterThanOrEqual(275.5);
      expect(res.body.data.byCategory).toBeDefined();
      expect(res.body.data.byPaymentMethod).toBeDefined();
      expect(res.body.data.timeline).toBeDefined();
    });
  });

  // ── 4. Revenue Reports & Net Profit ──────────────────────────────────────
  describe('Revenue & Net Profit Reporting', () => {
    it('should get comprehensive revenue report with Net Profit = Revenue - Expenses', async () => {
      const res = await request(app)
        .get('/api/admin/reports/revenue?groupBy=month')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      const data = res.body.data;
      expect(data.summary).toBeDefined();
      expect(typeof data.summary.netRevenue).toBe('number');
      expect(typeof data.summary.totalExpenses).toBe('number');
      expect(typeof data.summary.netProfit).toBe('number');

      // Verify formula Net Profit = Total Revenue - Total Expenses
      const expectedProfit = Math.round((data.summary.netRevenue - data.summary.totalExpenses) * 100) / 100;
      expect(data.summary.netProfit).toBe(expectedProfit);

      // Verify breakdown structures
      expect(data.revenueBySource).toBeDefined();
      expect(data.revenueBySource.onlineBookings).toBeDefined();
      expect(data.revenueBySource.posBookings).toBeDefined();
      expect(data.revenueByPaymentMethod).toBeDefined();
      expect(data.expensesByCategory).toBeDefined();
      expect(Array.isArray(data.timeline)).toBe(true);
      expect(data.recentTransactions).toBeDefined();
    });

    it('should get revenue executive summary KPI', async () => {
      const res = await request(app)
        .get('/api/admin/reports/revenue/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.totalNetRevenue).toBeDefined();
      expect(res.body.data.totalExpenses).toBeDefined();
      expect(res.body.data.netProfit).toBeDefined();
      expect(res.body.data.profitMarginPct).toBeDefined();
      expect(res.body.data.bookingMetrics).toBeDefined();
    });

    it('should get revenue vs expense trends with growth rates', async () => {
      const res = await request(app)
        .get('/api/admin/reports/revenue/trends?interval=month')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.trends)).toBe(true);
      if (res.body.data.trends.length > 0) {
        const first = res.body.data.trends[0];
        expect(first.period).toBeDefined();
        expect(typeof first.revenue).toBe('number');
        expect(typeof first.expenses).toBe('number');
        expect(typeof first.netProfit).toBe('number');
      }
    });

    it('should delete expense and then permit deleting the empty category', async () => {
      // 1. Delete expense
      const delExpenseRes = await request(app)
        .delete(`/api/admin/expenses/${testExpenseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delExpenseRes.status).toBe(200);

      // Remove from createdExpenseIds array
      const idx = createdExpenseIds.indexOf(testExpenseId);
      if (idx !== -1) createdExpenseIds.splice(idx, 1);

      // 2. Delete now-empty category
      const delCatRes = await request(app)
        .delete(`/api/admin/expense-categories/${testCategoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delCatRes.status).toBe(200);

      // Remove from createdCategoryIds array
      const cIdx = createdCategoryIds.indexOf(testCategoryId);
      if (cIdx !== -1) createdCategoryIds.splice(cIdx, 1);
    });
  });
});
