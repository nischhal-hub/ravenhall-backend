import { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  CategoryExpenseBreakdown,
  GroupByInterval,
  PaymentMethodBreakdown,
  PeriodFinancialMetric,
  RevenueReportFilter,
  RevenueReportResult,
  RevenueSourceBreakdown,
  RevenueSummaryResult,
  RevenueTrendsFilter,
  RevenueTrendsResult,
} from './reports.types';

export class ReportsService {
  /**
   * Helper: Parse and standardize date range boundaries
   */
  private parseDateRange(from?: string, to?: string): { startDate: Date; endDate: Date } {
    const endDate = to
      ? new Date(to.includes('T') ? to : `${to}T23:59:59.999Z`)
      : new Date();

    const startDate = from
      ? new Date(from.includes('T') ? from : `${from}T00:00:00.000Z`)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    return { startDate, endDate };
  }

  /**
   * Helper: Formats a date into a chronological grouping key
   */
  private getPeriodKey(date: Date, interval: GroupByInterval): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();

    if (interval === 'year') {
      return `${year}`;
    }

    if (interval === 'month') {
      return `${year}-${String(month).padStart(2, '0')}`;
    }

    if (interval === 'week') {
      const firstJan = new Date(year, 0, 1);
      const days = Math.floor((d.getTime() - firstJan.getTime()) / (24 * 60 * 60 * 1000));
      const week = Math.ceil((days + firstJan.getDay() + 1) / 7);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }

    // default: 'day'
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Comprehensive Revenue & Net Profit Report
   * Net Profit = Total Revenue - Total Expenses
   */
  async getRevenueReport(filter: RevenueReportFilter): Promise<RevenueReportResult> {
    const { from, to, groupBy = 'day' } = filter;
    const { startDate, endDate } = this.parseDateRange(from, to);

    // 1. Fetch legitimate revenue transactions (SUCCEEDED or PARTIALLY_REFUNDED)
    const payments = await prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] },
        OR: [
          { paidAt: { gte: startDate, lte: endDate } },
          { paidAt: null, createdAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        booking: {
          select: { id: true, bookingRef: true, source: true },
        },
        membership: {
          select: { id: true, plan: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Fetch business expenses for the exact same date window
    const expenses = await prisma.expense.findMany({
      where: {
        expenseDate: { gte: startDate, lte: endDate },
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
      orderBy: { expenseDate: 'asc' },
    });

    // 3. Process Revenue Metrics
    let grossRevenue = 0;
    let totalRefunds = 0;

    const sourceBreakdown: RevenueSourceBreakdown = {
      onlineBookings: { total: 0, count: 0 },
      posBookings: { total: 0, count: 0 },
      memberships: { total: 0, count: 0 },
    };

    const paymentMethodMap: Record<string, { total: number; count: number }> = {};
    const timelineMap: Record<string, PeriodFinancialMetric> = {};

    let totalBookings = 0;

    for (const p of payments) {
      const net = Math.round((p.amount - (p.refundAmount || 0)) * 100) / 100;
      grossRevenue += p.amount;
      totalRefunds += p.refundAmount || 0;

      // Source breakdown
      if (p.booking) {
        totalBookings += 1;
        if (p.booking.source === 'POS') {
          sourceBreakdown.posBookings.total += net;
          sourceBreakdown.posBookings.count += 1;
        } else {
          sourceBreakdown.onlineBookings.total += net;
          sourceBreakdown.onlineBookings.count += 1;
        }
      } else if (p.membership) {
        sourceBreakdown.memberships.total += net;
        sourceBreakdown.memberships.count += 1;
      } else {
        // Fallback for general booking
        sourceBreakdown.onlineBookings.total += net;
        sourceBreakdown.onlineBookings.count += 1;
      }

      // Payment method breakdown
      const methodKey = p.paymentMethod || 'STRIPE';
      if (!paymentMethodMap[methodKey]) {
        paymentMethodMap[methodKey] = { total: 0, count: 0 };
      }
      paymentMethodMap[methodKey].total += net;
      paymentMethodMap[methodKey].count += 1;

      // Timeline mapping
      const key = this.getPeriodKey(p.paidAt || p.createdAt, groupBy);
      if (!timelineMap[key]) {
        timelineMap[key] = {
          period: key,
          revenue: 0,
          expenses: 0,
          netProfit: 0,
          profitMarginPct: 0,
          bookingCount: 0,
          expenseCount: 0,
        };
      }
      timelineMap[key].revenue += net;
      if (p.booking) timelineMap[key].bookingCount += 1;
    }

    // 4. Process Expense Metrics
    let totalExpenses = 0;
    const categoryMap: Record<string, { categoryId: string; name: string; total: number; count: number }> = {};

    for (const exp of expenses) {
      const amount = Math.round(exp.amount * 100) / 100;
      totalExpenses += amount;

      // Category breakdown
      const catId = exp.categoryId;
      const catName = exp.category?.name || 'Uncategorized';
      if (!categoryMap[catId]) {
        categoryMap[catId] = { categoryId: catId, name: catName, total: 0, count: 0 };
      }
      categoryMap[catId].total += amount;
      categoryMap[catId].count += 1;

      // Timeline mapping
      const key = this.getPeriodKey(exp.expenseDate, groupBy);
      if (!timelineMap[key]) {
        timelineMap[key] = {
          period: key,
          revenue: 0,
          expenses: 0,
          netProfit: 0,
          profitMarginPct: 0,
          bookingCount: 0,
          expenseCount: 0,
        };
      }
      timelineMap[key].expenses += amount;
      timelineMap[key].expenseCount += 1;
    }

    // 5. Final Calculations (Rounded)
    grossRevenue = Math.round(grossRevenue * 100) / 100;
    totalRefunds = Math.round(totalRefunds * 100) / 100;
    const netRevenue = Math.round((grossRevenue - totalRefunds) * 100) / 100;
    totalExpenses = Math.round(totalExpenses * 100) / 100;
    const netProfit = Math.round((netRevenue - totalExpenses) * 100) / 100;
    const profitMarginPct = netRevenue > 0 ? Math.round((netProfit / netRevenue) * 10000) / 100 : 0;

    sourceBreakdown.onlineBookings.total = Math.round(sourceBreakdown.onlineBookings.total * 100) / 100;
    sourceBreakdown.posBookings.total = Math.round(sourceBreakdown.posBookings.total * 100) / 100;
    sourceBreakdown.memberships.total = Math.round(sourceBreakdown.memberships.total * 100) / 100;

    const expensesByCategory: CategoryExpenseBreakdown[] = Object.values(categoryMap).map((c) => {
      const roundedTotal = Math.round(c.total * 100) / 100;
      return {
        categoryId: c.categoryId,
        categoryName: c.name,
        total: roundedTotal,
        count: c.count,
        percentage: totalExpenses > 0 ? Math.round((roundedTotal / totalExpenses) * 10000) / 100 : 0,
      };
    }).sort((a, b) => b.total - a.total);

    const revenueByPaymentMethod: PaymentMethodBreakdown[] = Object.entries(paymentMethodMap).map(([method, val]) => {
      const roundedTotal = Math.round(val.total * 100) / 100;
      return {
        method,
        total: roundedTotal,
        count: val.count,
        percentage: netRevenue > 0 ? Math.round((roundedTotal / netRevenue) * 10000) / 100 : 0,
      };
    }).sort((a, b) => b.total - a.total);

    // Build chronological timeline
    const timeline: PeriodFinancialMetric[] = Object.keys(timelineMap)
      .sort()
      .map((key) => {
        const item = timelineMap[key];
        const r = Math.round(item.revenue * 100) / 100;
        const e = Math.round(item.expenses * 100) / 100;
        const p = Math.round((r - e) * 100) / 100;
        return {
          period: key,
          revenue: r,
          expenses: e,
          netProfit: p,
          profitMarginPct: r > 0 ? Math.round((p / r) * 10000) / 100 : 0,
          bookingCount: item.bookingCount,
          expenseCount: item.expenseCount,
        };
      });

    // Recent transactions for table view
    const recentRevenues = payments.slice(-10).reverse().map((p) => ({
      id: p.id,
      date: p.paidAt || p.createdAt,
      amount: Math.round((p.amount - (p.refundAmount || 0)) * 100) / 100,
      paymentMethod: p.paymentMethod || 'STRIPE',
      source: p.booking?.source === 'POS' ? 'POS Booking' : p.membership ? 'Membership' : 'Online Booking',
      reference: p.booking?.bookingRef || p.stripePaymentIntentId || p.id,
    }));

    const recentExpenses = expenses.slice(-10).reverse().map((e) => ({
      id: e.id,
      date: e.expenseDate,
      title: e.title,
      amount: e.amount,
      categoryName: e.category.name,
      paymentMethod: e.paymentMethod || 'OTHER',
    }));

    return {
      dateRange: {
        from: startDate.toISOString().split('T')[0],
        to: endDate.toISOString().split('T')[0],
      },
      groupBy,
      summary: {
        grossRevenue,
        totalRefunds,
        netRevenue,
        totalExpenses,
        netProfit,
        profitMarginPct,
        totalBookings,
        totalExpensesCount: expenses.length,
      },
      revenueBySource: sourceBreakdown,
      revenueByPaymentMethod,
      expensesByCategory,
      timeline,
      recentTransactions: {
        revenues: recentRevenues,
        expenses: recentExpenses,
      },
    };
  }

  /**
   * Executive Revenue & Expense Summary KPI
   */
  async getRevenueSummary(from?: string, to?: string): Promise<RevenueSummaryResult> {
    const report = await this.getRevenueReport({ from, to, groupBy: 'month' });

    const topCategory = report.expensesByCategory.length > 0 ? {
      name: report.expensesByCategory[0].categoryName,
      amount: report.expensesByCategory[0].total,
      percentage: report.expensesByCategory[0].percentage,
    } : null;

    return {
      dateRange: report.dateRange,
      totalGrossRevenue: report.summary.grossRevenue,
      totalRefunds: report.summary.totalRefunds,
      totalNetRevenue: report.summary.netRevenue,
      totalExpenses: report.summary.totalExpenses,
      netProfit: report.summary.netProfit,
      profitMarginPct: report.summary.profitMarginPct,
      bookingMetrics: {
        totalBookings: report.summary.totalBookings,
        avgRevenuePerBooking:
          report.summary.totalBookings > 0
            ? Math.round((report.summary.netRevenue / report.summary.totalBookings) * 100) / 100
            : 0,
      },
      revenueBySource: report.revenueBySource,
      revenueByPaymentMethod: report.revenueByPaymentMethod,
      topExpenseCategory: topCategory,
    };
  }

  /**
   * Revenue vs Expense Trends over time with growth rates
   */
  async getRevenueTrends(filter: RevenueTrendsFilter): Promise<RevenueTrendsResult> {
    const report = await this.getRevenueReport({
      from: filter.from,
      to: filter.to,
      groupBy: filter.interval || 'month',
    });

    const trends = report.timeline.map((point, index) => {
      let revenueGrowthPct: number | null = null;
      let expenseGrowthPct: number | null = null;

      if (index > 0) {
        const prev = report.timeline[index - 1];
        if (prev.revenue > 0) {
          revenueGrowthPct = Math.round(((point.revenue - prev.revenue) / prev.revenue) * 10000) / 100;
        }
        if (prev.expenses > 0) {
          expenseGrowthPct = Math.round(((point.expenses - prev.expenses) / prev.expenses) * 10000) / 100;
        }
      }

      return {
        ...point,
        revenueGrowthPct,
        expenseGrowthPct,
      };
    });

    return {
      dateRange: report.dateRange,
      interval: filter.interval || 'month',
      trends,
    };
  }
}
