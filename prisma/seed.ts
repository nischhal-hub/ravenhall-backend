import { PrismaClient, LaneType, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Admin user
  const adminPassword = await bcrypt.hash("Admin@123", 12);
  await prisma.user.upsert({
    where: { email: "admin@ravenhallcricket.com.au" },
    update: {},
    create: {
      email: "admin@ravenhallcricket.com.au",
      password: adminPassword,
      firstName: "Admin",
      lastName: "Ravenhall",
      role: Role.ADMIN,
      isEmailVerified: true,
    },
  });

  // Staff user
  const staffPassword = await bcrypt.hash("Staff@123", 12);
  await prisma.user.upsert({
    where: { email: "staff@ravenhallcricket.com.au" },
    update: {},
    create: {
      email: "staff@ravenhallcricket.com.au",
      password: staffPassword,
      firstName: "Staff",
      lastName: "Member",
      role: Role.STAFF,
      isEmailVerified: true,
    },
  });

  // Test customer
  const customerPassword = await bcrypt.hash("Test@123", 12);
  await prisma.user.upsert({
    where: { email: "customer@test.com" },
    update: {},
    create: {
      email: "customer@test.com",
      password: customerPassword,
      firstName: "Test",
      lastName: "Customer",
      role: Role.CUSTOMER,
      isEmailVerified: true,
    },
  });

  // Lanes
  const lanes = [
    { name: "Lane 1 — Batting", type: LaneType.BATTING, hourlyRate: 45, capacity: 6 },
    { name: "Lane 2 — Batting", type: LaneType.BATTING, hourlyRate: 45, capacity: 6 },
    { name: "Lane 3 — Bowling", type: LaneType.BOWLING, hourlyRate: 40, capacity: 8 },
    { name: "Lane 4 — Bowling", type: LaneType.BOWLING, hourlyRate: 40, capacity: 8 },
    { name: "Lane 5 — General", type: LaneType.GENERAL, hourlyRate: 35, capacity: 10 },
    { name: "Lane 6 — General", type: LaneType.GENERAL, hourlyRate: 35, capacity: 10 },
  ];

  for (const lane of lanes) {
    await prisma.lane.upsert({
      where: { name: lane.name },
      update: {},
      create: lane,
    });
  }

  // Discount code
  await prisma.discountCode.upsert({
    where: { code: "WELCOME10" },
    update: {},
    create: {
      code: "WELCOME10",
      description: "10% off for new customers",
      discountPct: 10,
      maxUses: 100,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  console.log("Seeding complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
