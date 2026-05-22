// ─────────────────────────────────────────────────────────────────────────────
//  FAST SEED  — Ravenhall Cricket Centre
//
//  Slots   : upcoming 61 days only (today → +60), 10:00–18:00, bulk createMany
//  History : past 365 days of bookings/payments WITHOUT slot rows (dashboards
//            only need booking.createdAt + payment.amount for charts)
//  Speed   : ~200-row batches + createMany → typically < 30 s total
// ─────────────────────────────────────────────────────────────────────────────
import {
  PrismaClient,
  LaneType,
  Role,
  MembershipPlan,
  BookingStatus,
  PaymentStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

const SALT_ROUNDS = 12;

// ── Helpers ────────────────────────────────────────────────────────────────

const log = (e: string, k: string) => console.log(`  ✓  [${e}] ${k}`);
const rb = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function ref(i: number) {
  return `RIC-2025-${String(i).padStart(5, '0')}`;
}

// ── Static data ────────────────────────────────────────────────────────────

const RAW_USERS = [
  {
    email: 'admin@ravenhallcricket.com.au',
    password: 'Admin@123',
    firstName: 'Admin',
    lastName: 'Ravenhall',
    role: Role.ADMIN,
  },
  {
    email: 'staff@ravenhallcricket.com.au',
    password: 'Staff@123',
    firstName: 'Jordan',
    lastName: 'Mitchell',
    role: Role.STAFF,
  },
  {
    email: 'staff2@ravenhallcricket.com.au',
    password: 'Staff@123',
    firstName: 'Priya',
    lastName: 'Sharma',
    role: Role.STAFF,
  },
  {
    email: 'liam.johnson@gmail.com',
    password: 'Pass@123',
    firstName: 'Liam',
    lastName: 'Johnson',
    role: Role.CUSTOMER,
  },
  {
    email: 'emma.williams@gmail.com',
    password: 'Pass@123',
    firstName: 'Emma',
    lastName: 'Williams',
    role: Role.CUSTOMER,
  },
  {
    email: 'noah.brown@gmail.com',
    password: 'Pass@123',
    firstName: 'Noah',
    lastName: 'Brown',
    role: Role.CUSTOMER,
  },
  {
    email: 'olivia.jones@gmail.com',
    password: 'Pass@123',
    firstName: 'Olivia',
    lastName: 'Jones',
    role: Role.CUSTOMER,
  },
  {
    email: 'william.davis@gmail.com',
    password: 'Pass@123',
    firstName: 'William',
    lastName: 'Davis',
    role: Role.CUSTOMER,
  },
] as const;

const LANE_SEEDS = [
  {
    name: 'Lane 1 — Batting',
    type: LaneType.BATTING,
    hourlyRate: 45,
    capacity: 6,
    description: 'Full-length batting lane with automated bowling machine.',
  },
  {
    name: 'Lane 2 — Batting',
    type: LaneType.BATTING,
    hourlyRate: 45,
    capacity: 6,
    description: 'Full-length batting lane ideal for group coaching sessions.',
  },
  {
    name: 'Lane 3 — Bowling',
    type: LaneType.BOWLING,
    hourlyRate: 40,
    capacity: 8,
    description: 'Dedicated bowling crease with run-up and pitch markings.',
  },
  {
    name: 'Lane 4 — Bowling',
    type: LaneType.BOWLING,
    hourlyRate: 40,
    capacity: 8,
    description: 'Dedicated bowling crease with run-up and pitch markings.',
  },
  {
    name: 'Lane 5 — General',
    type: LaneType.GENERAL,
    hourlyRate: 35,
    capacity: 10,
    description:
      'Multi-purpose lane suitable for fielding drills and warm-ups.',
  },
  {
    name: 'Lane 6 — General',
    type: LaneType.GENERAL,
    hourlyRate: 35,
    capacity: 10,
    description:
      'Multi-purpose lane suitable for fielding drills and warm-ups.',
  },
];

const DISCOUNT_SEEDS = [
  {
    code: 'WELCOME10',
    description: '10% off for new customers',
    discountPct: 10,
    maxUses: 100,
    validForDays: 90,
  },
  {
    code: 'STAFF20',
    description: '20% staff discount',
    discountPct: 20,
    maxUses: null,
    validForDays: 365,
  },
  {
    code: 'SUMMER15',
    description: '15% summer promo',
    discountPct: 15,
    maxUses: 50,
    validForDays: 60,
  },
];

// 10:00 → 18:00  (8 one-hour slots per lane per day)
const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

// ── Clear ──────────────────────────────────────────────────────────────────

async function clearAll() {
  console.log('\n── Clearing ALL data ──');
  await prisma.notification.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingItem.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.discountCode.deleteMany();
  await prisma.lane.deleteMany();
  await prisma.user.deleteMany();
  console.log('  ✓  All tables cleared');
}

// ── Users ──────────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log('\n── Users ──');
  const ids: Record<string, string> = {};
  for (const u of RAW_USERS) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        password: await bcrypt.hash(u.password, SALT_ROUNDS),
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isEmailVerified: true,
      },
    });
    ids[u.email] = created.id;
    log('User', u.email);
  }
  return ids;
}

// ── Lanes ──────────────────────────────────────────────────────────────────

async function seedLanes() {
  console.log('\n── Lanes ──');
  const lanes: { id: string; hourlyRate: number }[] = [];
  for (const l of LANE_SEEDS) {
    const created = await prisma.lane.create({
      data: { ...l, isActive: true },
    });
    lanes.push({ id: created.id, hourlyRate: l.hourlyRate });
    log('Lane', l.name);
  }
  return lanes;
}

// ── Discount codes ─────────────────────────────────────────────────────────

async function seedDiscountCodes() {
  console.log('\n── Discount Codes ──');
  const now = new Date();
  const codes: Record<string, { id: string; pct: number }> = {};
  for (const s of DISCOUNT_SEEDS) {
    const dc = await prisma.discountCode.create({
      data: {
        code: s.code,
        description: s.description,
        discountPct: s.discountPct,
        maxUses: s.maxUses,
        validFrom: now,
        validTo: addDays(now, s.validForDays),
        isActive: true,
      },
    });
    codes[s.code] = { id: dc.id, pct: s.discountPct };
    log('DiscountCode', s.code);
  }
  return codes;
}

// ── Memberships ────────────────────────────────────────────────────────────

async function seedMemberships(userIds: Record<string, string>) {
  console.log('\n── Memberships ──');
  const now = new Date();
  const rows = [
    { email: 'liam.johnson@gmail.com', plan: MembershipPlan.ANNUAL, pct: 15 },
    { email: 'emma.williams@gmail.com', plan: MembershipPlan.ANNUAL, pct: 15 },
    { email: 'noah.brown@gmail.com', plan: MembershipPlan.MONTHLY, pct: 10 },
    { email: 'olivia.jones@gmail.com', plan: MembershipPlan.MONTHLY, pct: 10 },
  ];
  for (const { email, plan, pct } of rows) {
    const userId = userIds[email];
    if (!userId) continue;
    const startDate = daysAgo(rb(30, 180));
    const endDate = addDays(
      startDate,
      plan === MembershipPlan.ANNUAL ? 365 : 30,
    );
    await prisma.membership.create({
      data: {
        userId,
        plan,
        discountPct: pct,
        startDate,
        endDate,
        isActive: endDate >= now,
      },
    });
    log('Membership', `${email} → ${plan}`);
  }
}

// ── UPCOMING slots (bulk, one createMany per day) ──────────────────────────

async function seedUpcomingSlots(lanes: { id: string; hourlyRate: number }[]) {
  console.log('\n── Upcoming Slots: today → +60 days, 10:00–18:00 ──');
  let total = 0;
  for (let d = 0; d <= 60; d++) {
    const date = daysFromNow(d);
    const rows = lanes.flatMap((lane) =>
      SLOT_HOURS.map((h) => ({
        laneId: lane.id,
        date,
        startTime: `${String(h).padStart(2, '0')}:00`,
        endTime: `${String(h + 1).padStart(2, '0')}:00`,
        isAvailable: true,
        isBlocked: false,
      })),
    );
    await prisma.timeSlot.createMany({ data: rows, skipDuplicates: true });
    total += rows.length;
  }
  // 61 days × 6 lanes × 8 hours = 2 928 rows — fast
  console.log(`  ✓  ${total} upcoming slots`);
}

// ── HISTORICAL bookings (no slot rows — just booking + payment) ────────────
//
//  Dashboard revenue/booking charts only JOIN on booking.createdAt and
//  payment.amount — they don't need a real TimeSlot row. This lets us seed
//  a full year of history in a few seconds instead of minutes.

async function seedHistoricalBookings(
  lanes: { id: string; hourlyRate: number }[],
  customerIds: string[],
  codes: Record<string, { id: string; pct: number }>,
) {
  console.log('\n── Historical Bookings: past 365 days (bulk batches) ──');

  const BATCH_SIZE = 200;
  const discountKeys = ['WELCOME10', 'SUMMER15']; // exclude STAFF20

  type BRow = {
    bookingRef: string;
    userId: string;
    status: BookingStatus;
    totalAmount: number;
    discountAmount: number;
    finalAmount: number;
    discountCodeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  let batchBuf: BRow[] = [];
  let bookingIdx = 1;
  let totalBookings = 0;
  const dcUsage = new Map<string, number>();

  const flush = async (rows: BRow[]) => {
    if (!rows.length) return;
    await prisma.booking.createMany({ data: rows });

    // Fetch back IDs by ref
    const created = await prisma.booking.findMany({
      where: { bookingRef: { in: rows.map((r) => r.bookingRef) } },
      select: {
        id: true,
        bookingRef: true,
        finalAmount: true,
        status: true,
        discountCodeId: true,
        createdAt: true,
      },
    });

    // Payments in one createMany
    await prisma.payment.createMany({
      data: created.map((b) => {
        const refunded = b.status === BookingStatus.CANCELLED;
        const pending = b.status === BookingStatus.PENDING;
        return {
          bookingId: b.id,
          stripePaymentIntentId: `pi_hist_${b.id.replace(/-/g, '').slice(0, 20)}`,
          amount: b.finalAmount,
          currency: 'aud',
          status: refunded
            ? PaymentStatus.REFUNDED
            : pending
              ? PaymentStatus.PENDING
              : PaymentStatus.SUCCEEDED,
          refundAmount: refunded ? b.finalAmount : null,
          paidAt: pending ? null : b.createdAt,
          createdAt: b.createdAt,
          updatedAt: b.createdAt,
        };
      }),
    });

    // Tally discount usage
    for (const b of created) {
      if (b.discountCodeId)
        dcUsage.set(b.discountCodeId, (dcUsage.get(b.discountCodeId) ?? 0) + 1);
    }

    totalBookings += rows.length;
    process.stdout.write(`\r  ↻  ${totalBookings} bookings...`);
  };

  for (let dayOffset = -365; dayOffset < 0; dayOffset++) {
    const date = daysAgo(-dayOffset);
    const monthsAgo = Math.abs(dayOffset) / 30;

    // Growth curve: fewer bookings further in the past
    const avg = monthsAgo < 1 ? 8 : monthsAgo < 3 ? 6 : monthsAgo < 6 ? 4 : 2;
    const count = rb(Math.max(1, avg - 2), avg + 2);

    for (let i = 0; i < count; i++) {
      const lane = pick(lanes);
      const userId = pick(customerIds);
      const useDiscount = Math.random() < 0.2;
      const dk = useDiscount ? pick(discountKeys) : null;
      const dc = dk ? codes[dk] : null;
      const discPct = dc?.pct ?? 0;
      const total = lane.hourlyRate;
      const disc = parseFloat(((discPct / 100) * total).toFixed(2));
      const final = parseFloat((total - disc).toFixed(2));

      const r = Math.random();
      const status =
        r < 0.05
          ? BookingStatus.CANCELLED
          : r < 0.08
            ? BookingStatus.PENDING
            : BookingStatus.COMPLETED;

      const createdAt = new Date(date);
      createdAt.setHours(rb(8, 20), rb(0, 59), 0, 0);

      batchBuf.push({
        bookingRef: ref(bookingIdx++),
        userId,
        status,
        totalAmount: total,
        discountAmount: disc,
        finalAmount: final,
        discountCodeId: dc?.id ?? null,
        createdAt,
        updatedAt: createdAt,
      });

      if (batchBuf.length >= BATCH_SIZE) {
        await flush(batchBuf);
        batchBuf = [];
      }
    }
  }

  await flush(batchBuf);

  // Update discount usedCount
  for (const [id, count] of dcUsage) {
    await prisma.discountCode.update({
      where: { id },
      data: { usedCount: { increment: count } },
    });
  }

  console.log(`\r  ✓  ${totalBookings} historical bookings + payments`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏏  Ravenhall Cricket Centre — Fast Reseed');

  await clearAll();

  const userIds = await seedUsers();
  const lanes = await seedLanes();
  const codes = await seedDiscountCodes();
  await seedMemberships(userIds);

  const customerEmails = [
    'liam.johnson@gmail.com',
    'emma.williams@gmail.com',
    'noah.brown@gmail.com',
    'olivia.jones@gmail.com',
    'william.davis@gmail.com',
  ];
  const customerIds = customerEmails.map((e) => userIds[e]).filter(Boolean);

  await seedUpcomingSlots(lanes);
  await seedHistoricalBookings(lanes, customerIds, codes);

  console.log('\n✅  Seed complete!');
  console.log('   admin@ravenhallcricket.com.au  /  Admin@123');
  console.log('   staff@ravenhallcricket.com.au  /  Staff@123');
  console.log('   liam.johnson@gmail.com          /  Pass@123');
}

main()
  .catch((e) => {
    console.error('\n❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
