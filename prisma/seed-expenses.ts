import { PrismaClient, PaymentMethod } from '@prisma/client';

const prisma = new PrismaClient();

async function seedExpenses() {
  console.log('--- Seeding Expenses for Ravenhall Indoor Cricket Centre ---');

  // 1. Find Admin user
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!admin) {
    throw new Error('Admin user not found in database. Please ensure users exist.');
  }

  // 2. Fetch all categories
  const categories = await prisma.expenseCategory.findMany();
  const catMap = new Map(categories.map((c) => [c.name, c.id]));

  const getCatId = (name: string): string => {
    const id = catMap.get(name);
    if (!id) {
      throw new Error(`Category "${name}" not found. Available: ${Array.from(catMap.keys()).join(', ')}`);
    }
    return id;
  };

  const now = new Date();
  const daysAgo = (days: number): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };

  // 3. Define realistic sample expenses
  const sampleExpenses: Array<{
    title: string;
    amount: number;
    categoryName: string;
    description: string;
    daysAgo: number;
    paymentMethod: PaymentMethod;
  }> = [
    {
      title: 'Facility Monthly Rent - Ravenhall Indoor Sports Shed',
      amount: 4500.0,
      categoryName: 'Rent',
      description: 'Monthly commercial lease payment for indoor cricket center facility',
      daysAgo: 5,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Facility Monthly Rent - Ravenhall Indoor Sports Shed',
      amount: 4500.0,
      categoryName: 'Rent',
      description: 'Monthly commercial lease payment for previous month',
      daysAgo: 35,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Power & High-Bay Floodlights Electricity Bill',
      amount: 1120.5,
      categoryName: 'Utilities',
      description: 'Quarterly electricity bill for indoor stadium lighting and HVAC system',
      daysAgo: 12,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Water & Amenity Usage Bill',
      amount: 285.0,
      categoryName: 'Utilities',
      description: 'Council water utility for player changerooms and amenities',
      daysAgo: 18,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Synthetic Grass Pitch Trimming & Lawn Maintenance',
      amount: 650.0,
      categoryName: 'Ground Maintenance',
      description: 'Professional grass-cutting, turf brush grooming and outfield levelling',
      daysAgo: 3,
      paymentMethod: PaymentMethod.CASH,
    },
    {
      title: 'Cricket Netting & Safety Cable Tensioning',
      amount: 420.0,
      categoryName: 'Ground Maintenance',
      description: 'Inspection and tightening of partition netting between Lane 1 and Lane 2',
      daysAgo: 15,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Pitch 2 AstroTurf Seam Repair & Rubber Infill',
      amount: 580.0,
      categoryName: 'Ground Maintenance',
      description: 'Repaired crease area tearing and replenished silica sand/rubber pellets',
      daysAgo: 28,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Synthetic Turf Maintenance & Deep Vacuum',
      amount: 650.0,
      categoryName: 'Ground Maintenance',
      description: 'Bi-monthly deep vacuum and sanitization of turf lanes',
      daysAgo: 45,
      paymentMethod: PaymentMethod.CASH,
    },
    {
      title: 'Cricket Bowling Machine Servicing & Motor Calibration',
      amount: 750.0,
      categoryName: 'Equipment Maintenance',
      description: 'Paceman Pro & BOLA bowling machine wheel replacement and speed sensor check',
      daysAgo: 8,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Kookaburra Practice Cricket Balls (Box of 24)',
      amount: 360.0,
      categoryName: 'Equipment Maintenance',
      description: '2-piece leather and heavy polyurethane practice balls for machine lanes',
      daysAgo: 22,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Scoreboard LED Display Panel Maintenance',
      amount: 340.0,
      categoryName: 'Equipment Maintenance',
      description: 'Replaced faulty power supply unit on digital score matrix',
      daysAgo: 40,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Head Coach & Pitch Curator Bi-weekly Salary',
      amount: 2800.0,
      categoryName: 'Salaries & Wages',
      description: 'Staff payroll transfer for lead curator and training coordinator',
      daysAgo: 6,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Head Coach & Pitch Curator Bi-weekly Salary',
      amount: 2800.0,
      categoryName: 'Salaries & Wages',
      description: 'Staff payroll transfer for lead curator and training coordinator',
      daysAgo: 20,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'Weekend Casual Duty Managers Wages',
      amount: 1450.0,
      categoryName: 'Salaries & Wages',
      description: 'Fortnightly wages for front-desk attendants and counter staff',
      daysAgo: 10,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'High-speed NBN Fiber Business Internet',
      amount: 149.0,
      categoryName: 'Office Supplies & IT',
      description: 'Monthly unlimited internet plan for live streaming and counter POS systems',
      daysAgo: 14,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Point of Sale Thermal Paper Rolls & Barcode Scanner',
      amount: 125.5,
      categoryName: 'Office Supplies & IT',
      description: '50 thermal receipt rolls and replacement USB laser scanner for front desk',
      daysAgo: 25,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Local Cricket Club League Sponsorship & Banner Display',
      amount: 450.0,
      categoryName: 'Marketing & Advertising',
      description: 'Sponsorship package for Melbourne Western Suburbs junior cricket tournament',
      daysAgo: 16,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Google Ads & Instagram Campaign - Winter Indoor Bookings',
      amount: 320.0,
      categoryName: 'Marketing & Advertising',
      description: 'Targeted pay-per-click advertising for off-peak lane reservations',
      daysAgo: 32,
      paymentMethod: PaymentMethod.CARD,
    },
    {
      title: 'Public Liability & Facility Property Insurance Premium',
      amount: 980.0,
      categoryName: 'Insurance & Licenses',
      description: 'Monthly sports facility risk and injury policy installment',
      daysAgo: 2,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      title: 'First Aid Kit Replenishment & Ice Compression Packs',
      amount: 95.0,
      categoryName: 'Miscellaneous',
      description: 'Emergency sports bandages, strapping tape, and instant cold packs',
      daysAgo: 7,
      paymentMethod: PaymentMethod.CASH,
    },
    {
      title: 'Sanitation, Floor Disinfectant & Restroom Supplies',
      amount: 140.0,
      categoryName: 'Miscellaneous',
      description: 'Commercial cleaning liquids, mop refills, and hand towel supplies',
      daysAgo: 21,
      paymentMethod: PaymentMethod.CASH,
    },
  ];

  // 4. Insert expenses
  let inserted = 0;
  for (const item of sampleExpenses) {
    const categoryId = getCatId(item.categoryName);
    const expenseDate = daysAgo(item.daysAgo);

    await prisma.expense.create({
      data: {
        title: item.title,
        amount: item.amount,
        categoryId,
        description: item.description,
        expenseDate,
        paymentMethod: item.paymentMethod,
        createdById: admin.id,
      },
    });
    inserted++;
  }

  const total = await prisma.expense.count();
  const sum = await prisma.expense.aggregate({ _sum: { amount: true } });

  console.log(`Successfully seeded ${inserted} expenses!`);
  console.log(`Total Expense Records: ${total}, Total Spent: $${sum._sum.amount?.toFixed(2)}`);
}

seedExpenses()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
