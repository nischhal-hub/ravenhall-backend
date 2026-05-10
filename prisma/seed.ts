/**
 * prisma/seed.ts
 * Production-grade seeder for Ravenhall Cricket Centre.
 * Fully idempotent • Realistic data • Chart-ready
 */

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

function log(entity: string, key: string) {
  console.log(`  ✓  [${entity}] ${key}`);
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ── Static seed data ───────────────────────────────────────────────────────

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
  // Customers
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
  {
    email: 'ava.miller@gmail.com',
    password: 'Pass@123',
    firstName: 'Ava',
    lastName: 'Miller',
    role: Role.CUSTOMER,
  },
  {
    email: 'james.wilson@gmail.com',
    password: 'Pass@123',
    firstName: 'James',
    lastName: 'Wilson',
    role: Role.CUSTOMER,
  },
  {
    email: 'sophia.moore@gmail.com',
    password: 'Pass@123',
    firstName: 'Sophia',
    lastName: 'Moore',
    role: Role.CUSTOMER,
  },
  {
    email: 'benjamin.taylor@gmail.com',
    password: 'Pass@123',
    firstName: 'Benjamin',
    lastName: 'Taylor',
    role: Role.CUSTOMER,
  },
  {
    email: 'isabella.anderson@gmail.com',
    password: 'Pass@123',
    firstName: 'Isabella',
    lastName: 'Anderson',
    role: Role.CUSTOMER,
  },
  {
    email: 'lucas.thomas@gmail.com',
    password: 'Pass@123',
    firstName: 'Lucas',
    lastName: 'Thomas',
    role: Role.CUSTOMER,
  },
  {
    email: 'mia.jackson@gmail.com',
    password: 'Pass@123',
    firstName: 'Mia',
    lastName: 'Jackson',
    role: Role.CUSTOMER,
  },
  {
    email: 'henry.white@gmail.com',
    password: 'Pass@123',
    firstName: 'Henry',
    lastName: 'White',
    role: Role.CUSTOMER,
  },
  {
    email: 'charlotte.harris@gmail.com',
    password: 'Pass@123',
    firstName: 'Charlotte',
    lastName: 'Harris',
    role: Role.CUSTOMER,
  },
  {
    email: 'alexander.martin@gmail.com',
    password: 'Pass@123',
    firstName: 'Alexander',
    lastName: 'Martin',
    role: Role.CUSTOMER,
  },
  {
    email: 'amelia.garcia@gmail.com',
    password: 'Pass@123',
    firstName: 'Amelia',
    lastName: 'Garcia',
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
  {
    code: 'MEMBER5',
    description: '5% loyalty reward',
    discountPct: 5,
    maxUses: 200,
    validForDays: 180,
  },
];

const MEMBERSHIP_MAP: Record<
  string,
  { plan: MembershipPlan; discountPct: number }
> = {
  'liam.johnson@gmail.com': { plan: MembershipPlan.ANNUAL, discountPct: 15 },
  'emma.williams@gmail.com': { plan: MembershipPlan.ANNUAL, discountPct: 15 },
  'noah.brown@gmail.com': { plan: MembershipPlan.MONTHLY, discountPct: 10 },
  'olivia.jones@gmail.com': { plan: MembershipPlan.MONTHLY, discountPct: 10 },
  'william.davis@gmail.com': { plan: MembershipPlan.MONTHLY, discountPct: 10 },
  'ava.miller@gmail.com': { plan: MembershipPlan.CASUAL, discountPct: 5 },
  'james.wilson@gmail.com': { plan: MembershipPlan.CASUAL, discountPct: 5 },
  'sophia.moore@gmail.com': { plan: MembershipPlan.ANNUAL, discountPct: 15 },
  'benjamin.taylor@gmail.com': {
    plan: MembershipPlan.MONTHLY,
    discountPct: 10,
  },
  'isabella.anderson@gmail.com': {
    plan: MembershipPlan.CASUAL,
    discountPct: 5,
  },
};

// ── Seed functions ─────────────────────────────────────────────────────────

async function clearDynamicData() {
  console.log('\n── Clearing old dynamic data ──');
  await prisma.payment.deleteMany();
  await prisma.bookingItem.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.membership.deleteMany();
  console.log(
    '  ✓  Cleared: payments, bookingItems, bookings, timeSlots, memberships',
  );
}

async function seedUsers() {
  console.log('\n── Users ──');
  const hashed = await Promise.all(
    RAW_USERS.map(async (u) => ({
      ...u,
      password: await bcrypt.hash(u.password, SALT_ROUNDS),
    })),
  );
  for (const user of hashed) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        email: user.email,
        password: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: true,
      },
    });
    log('User', user.email);
  }
}

async function seedLanes() {
  console.log('\n── Lanes ──');
  for (const lane of LANE_SEEDS) {
    await prisma.lane.upsert({
      where: { name: lane.name },
      update: {
        hourlyRate: lane.hourlyRate,
        capacity: lane.capacity,
        description: lane.description,
        isActive: true,
      },
      create: { ...lane, isActive: true },
    });
    log('Lane', lane.name);
  }
}

async function seedDiscountCodes() {
  console.log('\n── Discount Codes ──');
  const now = new Date();
  for (const seed of DISCOUNT_SEEDS) {
    const validFrom = new Date(now);
    const validTo = addDays(now, seed.validForDays);
    await prisma.discountCode.upsert({
      where: { code: seed.code },
      update: {
        description: seed.description,
        discountPct: seed.discountPct,
        maxUses: seed.maxUses,
        validFrom,
        validTo,
      },
      create: {
        code: seed.code,
        description: seed.description,
        discountPct: seed.discountPct,
        maxUses: seed.maxUses,
        validFrom,
        validTo,
        isActive: true,
      },
    });
    log('DiscountCode', seed.code);
  }
}

async function seedMemberships() {
  console.log('\n── Memberships ──');
  const now = new Date();

  for (const [email, config] of Object.entries(MEMBERSHIP_MAP)) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) continue;

    // Stagger start dates over the past 6 months for realism
    const randomOffset = randomBetween(0, 180);
    const startDate = daysAgo(randomOffset);
    const endDate = addDays(
      startDate,
      config.plan === MembershipPlan.ANNUAL
        ? 365
        : config.plan === MembershipPlan.MONTHLY
          ? 30
          : 7,
    );

    await prisma.membership.create({
      data: {
        userId: user.id,
        plan: config.plan,
        discountPct: config.discountPct,
        startDate,
        endDate,
        isActive: endDate >= now,
      },
    });
    log('Membership', `${email} → ${config.plan}`);
  }
}

// ── Core: time slots + realistic bookings over 6 months ───────────────────

async function seedSlotsAndBookings() {
  console.log('\n── Time Slots & Bookings (6 months of realistic data) ──');

  const lanes = await prisma.lane.findMany({
    select: { id: true, name: true, hourlyRate: true, type: true },
  });
  const customers = await prisma.user.findMany({
    where: { role: Role.CUSTOMER },
    select: { id: true, email: true },
  });

  if (!lanes.length || !customers.length) {
    console.log('  ⚠  No lanes or customers — skipping.');
    return;
  }

  // We'll generate slots for 180 days in the past + 14 days future
  const PAST_DAYS = 180;
  const FUTURE_DAYS = 14;
  const TOTAL_DAYS = PAST_DAYS + FUTURE_DAYS;

  // Business hours: 9am–9pm (hourly slots)
  const OPEN_HOUR = 9;
  const CLOSE_HOUR = 21; // last slot starts at 20:00

  // Booking density per day-of-week (0=Sun … 6=Sat), realistic cricket centre
  // Weekend peaks, quiet Tuesday/Wednesday
  const WEEKDAY_DENSITY = [0.6, 0.35, 0.3, 0.4, 0.5, 0.75, 0.8]; // Sun→Sat

  let totalBookings = 0;
  let refCounter = 1;

  for (let dayOffset = -PAST_DAYS; dayOffset <= FUTURE_DAYS; dayOffset++) {
    const date = addDays(new Date(), dayOffset);
    date.setHours(0, 0, 0, 0);

    const dow = date.getDay(); // 0=Sun
    const density = WEEKDAY_DENSITY[dow];

    for (const lane of lanes) {
      for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour++) {
        const startTime = `${hour.toString().padStart(2, '0')}:00`;
        const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

        // Slight lane-type demand variation
        const laneMultiplier =
          lane.type === 'BATTING' ? 1.15 : lane.type === 'BOWLING' ? 1.0 : 0.85;
        // Peak hours: 10–12, 17–20
        const hourMultiplier =
          (hour >= 10 && hour <= 12) || (hour >= 17 && hour <= 20) ? 1.3 : 0.8;

        const shouldBook =
          Math.random() < density * laneMultiplier * hourMultiplier;

        // Create the slot
        const slot = await prisma.timeSlot.create({
          data: {
            laneId: lane.id,
            date,
            startTime,
            endTime,
            isAvailable: !shouldBook || dayOffset > 0, // future slots stay available
            isBlocked: false,
          },
        });

        // Only create bookings for past/present slots with demand
        if (shouldBook && dayOffset <= 0) {
          const customer = customers[randomBetween(0, customers.length - 1)];
          const year = date.getFullYear();
          const bookingRef = `RIC-${year}-${String(refCounter).padStart(5, '0')}`;
          refCounter++;

          // Simulate some cancellations (~8%) and completions for older bookings
          let status: BookingStatus;
          if (dayOffset < -7) {
            const roll = Math.random();
            status =
              roll < 0.08
                ? BookingStatus.CANCELLED
                : roll < 0.85
                  ? BookingStatus.COMPLETED
                  : BookingStatus.CONFIRMED;
          } else if (dayOffset < 0) {
            status =
              Math.random() < 0.06
                ? BookingStatus.CANCELLED
                : BookingStatus.CONFIRMED;
          } else {
            status = BookingStatus.CONFIRMED;
          }

          // Apply a random discount to ~20% of bookings
          const applyDiscount = Math.random() < 0.2;
          const discountPct = applyDiscount
            ? [5, 10, 15, 20][randomBetween(0, 3)]
            : 0;
          const totalAmount = lane.hourlyRate;
          const discountAmount = parseFloat(
            ((totalAmount * discountPct) / 100).toFixed(2),
          );
          const finalAmount = parseFloat(
            (totalAmount - discountAmount).toFixed(2),
          );

          const booking = await prisma.booking.create({
            data: {
              bookingRef,
              userId: customer.id,
              status,
              totalAmount,
              discountAmount,
              finalAmount,
              createdAt: new Date(
                date.getTime() +
                  hour * 3600 * 1000 -
                  86400 * 1000 * randomBetween(0, 2),
              ),
            },
          });

          await prisma.bookingItem.create({
            data: {
              bookingId: booking.id,
              slotId: slot.id,
              unitPrice: lane.hourlyRate,
              subtotal: finalAmount,
            },
          });

          // Create payment for all non-cancelled bookings
          if (status !== BookingStatus.CANCELLED) {
            const paymentStatus =
              status === BookingStatus.COMPLETED
                ? PaymentStatus.SUCCEEDED
                : status === BookingStatus.CONFIRMED
                  ? PaymentStatus.SUCCEEDED
                  : PaymentStatus.PENDING;

            await prisma.payment.create({
              data: {
                bookingId: booking.id,
                stripePaymentIntentId: `pi_seed_${booking.id}`,
                amount: finalAmount,
                currency: 'aud',
                status: paymentStatus,
                paidAt:
                  paymentStatus === PaymentStatus.SUCCEEDED
                    ? new Date(date.getTime())
                    : null,
              },
            });
          }

          totalBookings++;
        }
      }
    }
  }

  console.log(
    `  ✓  Created ${totalBookings} bookings across ${TOTAL_DAYS} days`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏏  Ravenhall Cricket Centre – Full Reseed');
  console.log(`   Environment : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`   Started at  : ${new Date().toISOString()}`);

  await clearDynamicData();
  await seedUsers();
  await seedLanes();
  await seedDiscountCodes();
  await seedMemberships();
  await seedSlotsAndBookings();

  console.log(`\n✅  Reseed complete  (${new Date().toISOString()})\n`);
}

main()
  .catch((e) => {
    console.error('\n❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
