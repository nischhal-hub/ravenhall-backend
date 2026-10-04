export type GroupByInterval = 'day' | 'week' | 'month' | 'year';

export interface RevenueReportFilter {
  from?: string;
  to?: string;
  groupBy?: GroupByInterval;
}

export interface RevenueTrendsFilter {
  from?: string;
  to?: string;
  interval?: GroupByInterval;
}

export interface PeriodFinancialMetric {
  period: string; // e.g. "2026-10", "2026-10-04", "2026-W40"
  revenue: number;
  expenses: number;
  netProfit: number;
  profitMarginPct: number;
  bookingCount: number;
  expenseCount: number;
}

export interface CategoryExpenseBreakdown {
  categoryId: string;
  categoryName: string;
  total: number;
  count: number;
  percentage: number;
}

export interface RevenueSourceBreakdown {
  onlineBookings: { total: number; count: number };
  posBookings: { total: number; count: number };
  memberships: { total: number; count: number };
}

export interface PaymentMethodBreakdown {
  method: string;
  total: number;
  count: number;
  percentage: number;
}

export interface RevenueReportResult {
  dateRange: {
    from: string;
    to: string;
  };
  groupBy: GroupByInterval;
  summary: {
    grossRevenue: number;
    totalRefunds: number;
    netRevenue: number;
    totalExpenses: number;
    netProfit: number;
    profitMarginPct: number;
    totalBookings: number;
    totalExpensesCount: number;
  };
  revenueBySource: RevenueSourceBreakdown;
  revenueByPaymentMethod: PaymentMethodBreakdown[];
  expensesByCategory: CategoryExpenseBreakdown[];
  timeline: PeriodFinancialMetric[];
  recentTransactions: {
    revenues: Array<{
      id: string;
      date: Date;
      amount: number;
      paymentMethod: string;
      source: string;
      reference: string;
    }>;
    expenses: Array<{
      id: string;
      date: Date;
      title: string;
      amount: number;
      categoryName: string;
      paymentMethod: string;
    }>;
  };
}

export interface RevenueSummaryResult {
  dateRange: {
    from: string;
    to: string;
  };
  totalGrossRevenue: number;
  totalRefunds: number;
  totalNetRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  bookingMetrics: {
    totalBookings: number;
    avgRevenuePerBooking: number;
  };
  revenueBySource: RevenueSourceBreakdown;
  revenueByPaymentMethod: PaymentMethodBreakdown[];
  topExpenseCategory: {
    name: string;
    amount: number;
    percentage: number;
  } | null;
}

export interface RevenueTrendsResult {
  dateRange: {
    from: string;
    to: string;
  };
  interval: GroupByInterval;
  trends: Array<PeriodFinancialMetric & {
    revenueGrowthPct: number | null;
    expenseGrowthPct: number | null;
  }>;
}
