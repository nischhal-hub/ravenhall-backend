import request from 'supertest';
import app from '../app';
import { prisma } from '../config/database';
import { generateAccessToken } from '../utils/jwt';
import bcrypt from 'bcryptjs';

jest.setTimeout(45000);

describe('POS Module', () => {
  let staffToken: string;
  let customerToken: string;
  let staffUserId: string;
  let testCustomerId: string;
  let testLaneId: string;
  let testSlotId: string;
  let expectedRate: number;
  const testDate = '2026-11-20';

  beforeAll(async () => {
    // 1. Create a staff user for testing
    const hashedPassword = await bcrypt.hash('Staff@123456', 10);
    const staffUser = await prisma.user.upsert({
      where: { email: 'staff-pos-test@test-suite.com' },
      update: { role: 'STAFF' },
      create: {
        email: 'staff-pos-test@test-suite.com',
        firstName: 'Staff',
        lastName: 'Member',
        password: hashedPassword,
        role: 'STAFF',
        isEmailVerified: true,
      },
    });
    staffUserId = staffUser.id;
    staffToken = generateAccessToken({
      userId: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
    });

    // 2. Create a customer user for testing
    const customerUser = await prisma.user.upsert({
      where: { email: 'cust-pos-test@test-suite.com' },
      update: { role: 'CUSTOMER' },
      create: {
        email: 'cust-pos-test@test-suite.com',
        firstName: 'WalkIn',
        lastName: 'Tester',
        phone: '0412345678',
        password: hashedPassword,
        role: 'CUSTOMER',
        isEmailVerified: true,
      },
    });
    testCustomerId = customerUser.id;
    customerToken = generateAccessToken({
      userId: customerUser.id,
      email: customerUser.email,
      role: customerUser.role,
    });

    // 3. Ensure a lane and slot exist
    let lane = await prisma.lane.findFirst({ where: { isActive: true } });
    if (!lane) {
      lane = await prisma.lane.create({
        data: {
          name: 'POS Test Lane',
          type: 'BATTING',
          hourlyRate: 50.0,
          capacity: 4,
          isActive: true,
        },
      });
    }
    testLaneId = lane.id;
    expectedRate = lane.hourlyRate;

    // Create a dedicated slot for testDate
    const parsedDate = new Date(testDate);
    const slot = await prisma.timeSlot.upsert({
      where: {
        laneId_date_startTime: {
          laneId: testLaneId,
          date: parsedDate,
          startTime: '10:00',
        },
      },
      update: {
        isAvailable: true,
        isBlocked: false,
      },
      create: {
        laneId: testLaneId,
        date: parsedDate,
        startTime: '10:00',
        endTime: '11:00',
        isAvailable: true,
        isBlocked: false,
      },
    });
    testSlotId = slot.id;
  }, 45000);

  afterAll(async () => {
    // Cleanup created test records
    await prisma.notification.deleteMany({
      where: {
        user: {
          email: {
            in: ['staff-pos-test@test-suite.com', 'cust-pos-test@test-suite.com'],
          },
        },
      },
    });
    await prisma.bookingItem.deleteMany({
      where: { slotId: testSlotId },
    });
    await prisma.timeSlot.deleteMany({
      where: { id: testSlotId },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['staff-pos-test@test-suite.com', 'cust-pos-test@test-suite.com'],
        },
      },
    });
    await prisma.$disconnect();
  }, 45000);

  describe('Authorization Checks', () => {
    it('should reject unauthenticated request to /api/pos/lanes-and-slots', async () => {
      const res = await request(app).get(`/api/pos/lanes-and-slots?date=${testDate}`);
      expect(res.status).toBe(401);
    });

    it('should reject non-staff (CUSTOMER) request with 403', async () => {
      const res = await request(app)
        .get(`/api/pos/lanes-and-slots?date=${testDate}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/pos/lanes-and-slots', () => {
    it('should return lanes with slots for staff', async () => {
      const res = await request(app)
        .get(`/api/pos/lanes-and-slots?date=${testDate}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should fail when date query is missing', async () => {
      const res = await request(app)
        .get('/api/pos/lanes-and-slots')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/pos/customers & POST /api/pos/customers', () => {
    it('should search customers', async () => {
      const res = await request(app)
        .get('/api/pos/customers?search=Tester')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should quick-register a walk-in customer', async () => {
      const res = await request(app)
        .post('/api/pos/customers')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          firstName: 'John',
          lastName: 'WalkIn',
          phone: '0499887766',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.firstName).toBe('John');
      expect(res.body.data.lastName).toBe('WalkIn');
      expect(res.body.data.email).toContain('@guest.ravenhall.com');

      // Clean up created walk-in customer
      await prisma.user.delete({ where: { id: res.body.data.id } });
    });
  });

  describe('POST /api/pos/calculate-price', () => {
    it('should calculate price with subtotal and discounts', async () => {
      const res = await request(app)
        .post('/api/pos/calculate-price')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          slotIds: [testSlotId],
          customerId: testCustomerId,
          customDiscountPct: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.totalAmount).toBe(expectedRate);
      expect(res.body.data.finalAmount).toBe(Math.round(expectedRate * 0.9 * 100) / 100);
      expect(res.body.data.discountBreakdown.appliedPct).toBe(10);
    });
  });

  describe('POST /api/pos/bookings (Walk-in Ground Booking)', () => {
    let createdBookingId: string;

    it('should book ground for walk-in customer with cash payment', async () => {
      const res = await request(app)
        .post('/api/pos/bookings')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          customerId: testCustomerId,
          slotIds: [testSlotId],
          paymentMethod: 'CASH',
          paymentStatus: 'SUCCEEDED',
          notes: 'Walk-in paid cash at desk',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.bookingRef).toMatch(/^RIC-\d{4}-\d+/);
      expect(res.body.data.status).toBe('CONFIRMED');
      expect(res.body.data.payment.paymentMethod).toBe('CASH');
      expect(res.body.data.payment.status).toBe('SUCCEEDED');
      expect(res.body.data.source).toBe('POS');

      createdBookingId = res.body.data.id;

      // Slot should now be marked unavailable
      const slot = await prisma.timeSlot.findUnique({ where: { id: testSlotId } });
      expect(slot?.isAvailable).toBe(false);
    });

    it('should retrieve POS booking receipt', async () => {
      const res = await request(app)
        .get(`/api/pos/bookings/${createdBookingId}/receipt`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.receiptNumber).toBeDefined();
      expect(res.body.data.customer.name).toBe('WalkIn Tester');
      expect(res.body.data.payment.method).toBe('CASH');
      expect(res.body.data.venue.name).toBe('Ravenhall Indoor Cricket Centre');
    });

    it('should list POS bookings', async () => {
      const res = await request(app)
        .get('/api/pos/bookings')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.bookings.length).toBeGreaterThan(0);
      expect(res.body.data.meta).toBeDefined();
    });

    afterAll(async () => {
      if (createdBookingId) {
        await prisma.payment.deleteMany({ where: { bookingId: createdBookingId } });
        await prisma.bookingItem.deleteMany({ where: { bookingId: createdBookingId } });
        await prisma.booking.deleteMany({ where: { id: createdBookingId } });
      }
    });
  });
});
