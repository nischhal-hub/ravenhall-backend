export interface UserDashboardData {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };

  membership: {
    plan: string;
    isActive: boolean;
    endDate?: string;
    discountPct: number;
  } | null;

  stats: {
    totalBookings: number;
    totalSpent: number;
    upcomingBookings: number;
    cancelledBookings: number;
  };

  upcomingBookings: UserBooking[];
  recentBookings: UserBooking[];
  totalRevenueThisMonth?: number; // optional
}

export interface UserBooking {
  id: string;
  bookingRef: string;
  status: string;
  finalAmount: number;
  createdAt: string;
  date: string; // main booking date
  items: Array<{
    laneName: string;
    type: string;
    date: string;
    startTime: string;
    endTime: string;
  }>;
}
