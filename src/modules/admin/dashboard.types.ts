export interface DashboardData {
  userStats: UserStats;
  bookingStats: BookingStats;
  laneStats: LaneStats;
  membershipStats: MembershipStats;
  revenueTimeline: RevenueMonth[];
  mostBookedLanes: LaneSummary[];
  topCustomers: CustomerSummary[];
}

export interface UserStats {
  total: number;
  customers: number;
  staff: number;
  admins: number;
  newThisMonth: number;
}

export interface BookingStats {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  pending: number;
  totalRevenue: number;
  avgRevenuePerBooking: number;
}

export interface LaneStats {
  total: number;
  active: number;
  inactive: number;
  byType: Record<string, number>;
}

export interface MembershipStats {
  total: number;
  casual: number;
  monthly: number;
  annual: number;
}

export interface RevenueMonth {
  month: string;
  bookings: number;
  revenue: number;
}

export interface LaneSummary {
  laneId: string;
  laneName: string;
  laneType: string;
  bookings: number;
  revenue: number;
}

export interface CustomerSummary {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  totalSpent: number;
  bookings: number;
}

// Raw query types
export interface RawRevenueRow {
  month: Date;
  bookings: bigint;
  revenue: string;
}

export interface RawLaneRow {
  laneId: string;
  laneName: string;
  laneType: string;
  bookings: number;
  revenue: string;
}
