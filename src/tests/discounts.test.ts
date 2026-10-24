// Promo codes: shared validation rules and applying a code to an unpaid booking.
// Prisma and Stripe are mocked so this suite needs no database.
import request from 'supertest';

jest.mock('../config/database', () => {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    booking: { findFirst: jest.fn(), updateMany: jest.fn() },
    bookingItem: { update: jest.fn() },
    discountCode: { findUnique: jest.fn(), updateMany: jest.fn() },
    payment: { update: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../config/stripe', () => ({
  stripe: { paymentIntents: { retrieve: jest.fn(), update: jest.fn() } },
}));

import app from '../app';
import { prisma } from '../config/database';
import { stripe } from '../config/stripe';
import { generateAccessToken } from '../utils/jwt';

const db = prisma as any;
const retrieveIntent = stripe.paymentIntents.retrieve as jest.Mock;
const updateIntent = stripe.paymentIntents.update as jest.Mock;

const alice = { id: 'user-alice', email: 'alice@example.com', role: 'CUSTOMER' as const };
const auth = `Bearer ${generateAccessToken({ userId: alice.id, email: alice.email, role: alice.role })}`;

const DAY = 24 * 60 * 60 * 1000;
const code = (overrides: Record<string, unknown> = {}) => ({
  id: 'code-1',
  code: 'SAVE20',
  discountPct: 20,
  isActive: true,
  validFrom: new Date(Date.now() - DAY),
  validTo: new Date(Date.now() + DAY),
  maxUses: 10,
  usedCount: 0,
  minBookingAmount: null,
  ...overrides,
});
// Two hours at $50 + $10 equipment fee, no discount yet, created just now
const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  bookingRef: 'RIC-2026-00001',
  userId: alice.id,
  status: 'PENDING',
  source: 'ONLINE',
  createdAt: new Date(),
  totalAmount: 110,
  discountAmount: 0,
  finalAmount: 110,
  discountCodeId: null,
  items: [
    { id: 'item-1', unitPrice: 50 },
    { id: 'item-2', unitPrice: 50 },
  ],
  payment: null,
  ...overrides,
});

const apply = (body: Record<string, unknown> = { code: 'save20' }) =>
  request(app).post('/api/bookings/booking-1/discount').set('Authorization', auth).send(body);

beforeEach(() => {
  db.user.findUnique.mockResolvedValue(alice);
  db.discountCode.findUnique.mockResolvedValue(code());
  db.discountCode.updateMany.mockResolvedValue({ count: 1 });
  db.booking.updateMany.mockResolvedValue({ count: 1 });
  db.booking.findFirst.mockResolvedValue(booking());
});

afterEach(() => {
  jest.resetAllMocks();
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
});

describe('POST /api/bookings/:id/discount', () => {
  it('re-prices an unpaid booking: lane hire only, code counted once', async () => {
    const res = await apply();

    expect(res.status).toBe(200);
    // Case-insensitive lookup
    expect(db.discountCode.findUnique).toHaveBeenCalledWith({ where: { code: 'SAVE20' } });
    // 20% of $100 lane hire; the $10 equipment fee is never discounted
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'PENDING', discountCodeId: null },
      data: { discountCodeId: 'code-1', discountAmount: 20, finalAmount: 90 },
    });
    expect(db.bookingItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { subtotal: 40 },
    });
    // Usage limit re-checked atomically
    expect(db.discountCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-1', isActive: true, usedCount: { lt: 10 } },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('updates an open Stripe checkout so the customer pays the new price', async () => {
    db.booking.findFirst.mockResolvedValue(
      booking({ payment: { id: 'pay-1', status: 'PENDING', stripePaymentIntentId: 'pi_1' } }),
    );
    retrieveIntent.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method' });
    updateIntent.mockResolvedValue({});

    const res = await apply();

    expect(res.status).toBe(200);
    expect(updateIntent).toHaveBeenCalledWith('pi_1', { amount: 9000 });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: { amount: 90 } });
  });

  it('refuses once a payment is already processing', async () => {
    db.booking.findFirst.mockResolvedValue(
      booking({ payment: { id: 'pay-1', status: 'PENDING', stripePaymentIntentId: 'pi_1' } }),
    );
    retrieveIntent.mockResolvedValue({ id: 'pi_1', status: 'processing' });

    const res = await apply();

    expect(res.status).toBe(409);
    expect(updateIntent).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed (paid) bookings', { status: 'CONFIRMED' }, 409],
    ['a booking that already has a code', { discountCodeId: 'code-0' }, 409],
    ['counter (POS) bookings', { source: 'POS' }, 409],
    ['an expired hold', { createdAt: new Date(Date.now() - DAY) }, 409],
  ])('rejects %s', async (_label, overrides, status) => {
    db.booking.findFirst.mockResolvedValue(booking(overrides));

    const res = await apply();

    expect(res.status).toBe(status);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { validTo: new Date(Date.now() - DAY) }, 'This discount code has expired'],
    ['not started', { validFrom: new Date(Date.now() + DAY) }, 'This discount code is not active yet'],
    ['used up', { usedCount: 10 }, 'This discount code has reached its usage limit'],
    ['inactive', { isActive: false }, 'Invalid discount code'],
    ['below minimum spend', { minBookingAmount: 150 }, 'This code needs a booking of at least $150.00'],
  ])('rejects a code that is %s', async (_label, overrides, message) => {
    db.discountCode.findUnique.mockResolvedValue(code(overrides));

    const res = await apply();

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(message);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a better membership discount instead of using up the code', async () => {
    db.booking.findFirst.mockResolvedValue(booking({ discountAmount: 25, finalAmount: 85 }));

    const res = await apply();

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Your current discount is already better than this code');
    expect(db.discountCode.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when another request used the last redemption first', async () => {
    db.discountCode.updateMany.mockResolvedValue({ count: 0 });

    const res = await apply();

    expect(res.status).toBe(409);
  });

  it("returns 404 for someone else's booking", async () => {
    db.booking.findFirst.mockResolvedValue(null);

    const res = await apply();

    expect(res.status).toBe(404);
    expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ id: 'booking-1', userId: alice.id });
  });
});

describe('POST /api/discount/validate', () => {
  it('checks the minimum spend when an amount is given', async () => {
    db.discountCode.findUnique.mockResolvedValue(code({ minBookingAmount: 150 }));

    const below = await request(app)
      .post('/api/discount/validate')
      .set('Authorization', auth)
      .send({ code: 'SAVE20', amount: 110 });
    const noAmount = await request(app)
      .post('/api/discount/validate')
      .set('Authorization', auth)
      .send({ code: 'SAVE20' });

    expect(below.body.data).toMatchObject({ valid: false, discountPct: 0 });
    expect(noAmount.body.data).toMatchObject({ valid: true, discountPct: 20 });
  });
});
