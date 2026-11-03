// Online checkout: the booking is only created once its payment has succeeded.
// Prisma, Stripe and SMTP are mocked, so this suite needs no database or network.
import request from 'supertest';

jest.mock('../config/database', () => {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    timeSlot: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    membership: { findFirst: jest.fn() },
    discountCode: { findUnique: jest.fn(), updateMany: jest.fn() },
    booking: { create: jest.fn(), findUnique: jest.fn() },
    payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    notification: { createMany: jest.fn(), updateMany: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../config/stripe', () => ({
  stripe: {
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    refunds: { create: jest.fn() },
  },
}));
jest.mock('../config/email', () => ({
  transporter: { sendMail: jest.fn() },
  EMAIL_FROM: '"Ravenhall" <test@example.com>',
  isEmailEnabled: () => true,
}));

import app from '../app';
import { prisma } from '../config/database';
import { stripe } from '../config/stripe';
import { generateAccessToken } from '../utils/jwt';
import { BOOKING_CHECKOUT, PaymentsService } from '../modules/payments/payments.service';

type Row = Record<string, any>;

const db = prisma as any;
const intents = stripe.paymentIntents as unknown as Record<string, jest.Mock>;
const refunds = stripe.refunds as unknown as Record<string, jest.Mock>;
const service = new PaymentsService();

const alice = { id: 'user-alice', email: 'alice@example.com', role: 'CUSTOMER' as const, status: 'ACTIVE' };
const bob = { id: 'user-bob', email: 'bob@example.com', role: 'CUSTOMER' as const, status: 'ACTIVE' };
const staff = { id: 'user-staff', email: 'staff@example.com', role: 'STAFF' as const, status: 'ACTIVE' };
const tokenFor = (u: typeof alice | typeof staff) =>
  `Bearer ${generateAccessToken({ userId: u.id, email: u.email, role: u.role })}`;

// Asia/Kathmandu (UTC+05:45): 2:00 PM on 23 Oct 2026 is 08:15 UTC
const NOW_BEFORE = new Date('2026-10-23T06:00:00.000Z'); // 11:45 AM local
const NOW_AFTER_START = new Date('2026-10-23T08:20:00.000Z'); // 2:05 PM local

const lane = { id: 'lane-1', name: 'Lane 1', hourlyRate: 40 };
const slot = (id: string, startTime: string, endTime: string) => ({
  id,
  laneId: lane.id,
  date: new Date('2026-10-23T00:00:00.000Z'),
  startTime,
  endTime,
  isAvailable: true,
  isBlocked: false,
  lane,
});
const twoHours = [slot('slot-14', '14:00', '15:00'), slot('slot-15', '15:00', '16:00')];

// 2 x $40 lane hire + $10 equipment fee, 10% off the lane hire = $82
const checkoutMetadata = {
  type: BOOKING_CHECKOUT,
  userId: alice.id,
  slotIds: 'slot-14,slot-15',
  unitPrice: '40',
  itemSubtotal: '36',
  totalAmount: '90',
  discountAmount: '8',
  finalAmount: '82',
  discountCodeId: 'code-1',
};

const paidCheckout = (overrides: Row = {}) => ({
  id: 'pi_checkout',
  status: 'succeeded',
  amount_received: 8200,
  currency: 'aud',
  metadata: checkoutMetadata,
  ...overrides,
});

// Our own records, so the lock and refund paths behave like the database
let payment: Row | null;
let booking: Row | null;

const matchesStatus = (status: any, value: string) =>
  status === undefined || (typeof status === 'string' ? status === value : status.in.includes(value));

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_BEFORE, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  payment = {
    id: 'payment-1',
    stripePaymentIntentId: 'pi_checkout',
    bookingId: null,
    membershipId: null,
    status: 'PENDING',
    amount: 82,
    currency: 'aud',
  };
  booking = null;

  db.user.findUnique.mockImplementation(({ where }: Row) =>
    Promise.resolve([alice, bob, staff].find((u) => u.id === where.id) ?? null),
  );
  // Rolls our rows back when the callback throws, like the real transaction
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const saved = { payment: payment && { ...payment }, booking };
    try {
      return await fn(db);
    } catch (error) {
      ({ payment, booking } = saved);
      throw error;
    }
  });
  db.timeSlot.findUnique.mockResolvedValue(twoHours[0]);
  db.timeSlot.findMany.mockResolvedValue(twoHours);
  db.timeSlot.updateMany.mockResolvedValue({ count: 2 });
  db.membership.findFirst.mockResolvedValue({ discountPct: 10 });
  db.discountCode.updateMany.mockResolvedValue({ count: 1 });
  db.notification.createMany.mockResolvedValue({ count: 1 });
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.booking.findUnique.mockResolvedValue(null); // email lookup; nothing to send

  db.payment.findUnique.mockImplementation(({ where }: Row) => {
    const found =
      payment && (where.id === payment.id || where.stripePaymentIntentId === payment.stripePaymentIntentId);
    if (!found) return Promise.resolve(null);
    const linked = booking && payment!.bookingId === booking.id;
    return Promise.resolve({
      ...payment,
      booking: linked ? { id: booking!.id, bookingRef: booking!.bookingRef, userId: booking!.userId } : null,
    });
  });
  db.payment.updateMany.mockImplementation(({ where, data }: Row) => {
    const hit =
      payment &&
      (where.id === undefined || where.id === payment.id) &&
      (where.bookingId === undefined || where.bookingId === payment.bookingId) &&
      matchesStatus(where.status, payment.status);
    if (hit) Object.assign(payment!, data);
    return Promise.resolve({ count: hit ? 1 : 0 });
  });
  db.payment.update.mockImplementation(({ data }: Row) => Promise.resolve(Object.assign(payment!, data)));
  db.booking.create.mockImplementation(({ data }: Row) => {
    booking = { id: 'booking-new', ...data };
    return Promise.resolve(booking);
  });

  intents.create.mockResolvedValue({ id: 'pi_checkout', client_secret: 'secret_checkout', amount: 8200 });
  refunds.create.mockResolvedValue({ id: 're_checkout' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

describe('Starting checkout for a new online booking', () => {
  it('prices the session and opens a payment without creating a booking or holding the slots', async () => {
    const result = await service.startCheckout(alice.id, { slotId: 'slot-14', duration: 2 });

    expect(result).toEqual(
      expect.objectContaining({
        paymentIntentId: 'pi_checkout',
        clientSecret: 'secret_checkout',
        amount: 82,
        totalAmount: 90,
        discountAmount: 8,
        currency: 'aud',
      }),
    );
    expect(intents.create).toHaveBeenCalledWith({
      amount: 8200,
      currency: 'aud',
      metadata: expect.objectContaining({
        type: BOOKING_CHECKOUT,
        userId: alice.id,
        slotIds: 'slot-14,slot-15',
        finalAmount: '82',
      }),
    });
    expect(db.payment.create).toHaveBeenCalledWith({
      data: { stripePaymentIntentId: 'pi_checkout', amount: 82, currency: 'aud', status: 'PENDING' },
    });
    expect(db.booking.create).not.toHaveBeenCalled();
    expect(db.timeSlot.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a slot that is already booked, before opening a payment', async () => {
    db.timeSlot.findMany.mockResolvedValue([twoHours[0], { ...twoHours[1], isAvailable: false }]);

    await expect(service.startCheckout(alice.id, { slotId: 'slot-14', duration: 2 })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(intents.create).not.toHaveBeenCalled();
  });

  it('refuses a slot that has already started (Asia/Kathmandu time)', async () => {
    jest.setSystemTime(NOW_AFTER_START);

    const res = await request(app)
      .post('/api/payments/checkout')
      .set('Authorization', tokenFor(alice))
      .send({ slotId: 'slot-14' });

    expect(res.status).toBe(422);
    expect(intents.create).not.toHaveBeenCalled();
  });

  it('customers can no longer create unpaid bookings directly', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', tokenFor(alice))
      .send({ slotId: 'slot-14' });

    expect(res.status).toBe(403);
    expect(db.booking.create).not.toHaveBeenCalled();
  });
});

describe('Completing a paid checkout', () => {
  const succeededWebhook = (intent: Row) =>
    service.handleWebhookEvent({ type: 'payment_intent.succeeded', data: { object: intent } } as any);

  it('creates the booking as CONFIRMED, claims its slots and links the payment', async () => {
    await succeededWebhook(paidCheckout());

    expect(db.timeSlot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['slot-14', 'slot-15'] }, isAvailable: true, isBlocked: false },
      data: { isAvailable: false },
    });
    expect(db.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: alice.id,
        status: 'CONFIRMED',
        totalAmount: 90,
        discountAmount: 8,
        finalAmount: 82,
        discountCodeId: 'code-1',
        items: {
          create: [
            { slotId: 'slot-14', unitPrice: 40, subtotal: 36 },
            { slotId: 'slot-15', unitPrice: 40, subtotal: 36 },
          ],
        },
      }),
    });
    expect(payment).toMatchObject({ status: 'SUCCEEDED', bookingId: 'booking-new' });
    expect(db.discountCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-1' },
      data: { usedCount: { increment: 1 } },
    });
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ dedupeKey: 'booking-confirmed:booking-new' })],
      skipDuplicates: true,
    });
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('books once when the webhook and the return page both arrive', async () => {
    const first = await service.completeCheckout(paidCheckout() as any);
    const second = await service.completeCheckout(paidCheckout() as any);

    expect(db.booking.create).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ outcome: 'paid', bookingId: 'booking-new', bookingRef: booking!.bookingRef });
    expect(second).toEqual(first);
  });

  it('backs off without booking when another request takes the payment first', async () => {
    // Read as PENDING, but finished by a concurrent request before the lock
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.completeCheckout(paidCheckout() as any);

    expect(db.booking.create).not.toHaveBeenCalled();
    expect(refunds.create).not.toHaveBeenCalled();
    expect(result.outcome).toBe('unpaid');
  });

  it('refunds once, and books nothing, when the slot was taken while the customer paid', async () => {
    db.timeSlot.updateMany.mockResolvedValue({ count: 1 });

    const first = await service.completeCheckout(paidCheckout() as any);
    const retry = await service.completeCheckout(paidCheckout() as any);

    expect(first.outcome).toBe('refunded');
    expect(retry.outcome).toBe('refunded');
    expect(db.booking.create).not.toHaveBeenCalled();
    expect(refunds.create).toHaveBeenCalledTimes(1);
    expect(refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_checkout' },
      { idempotencyKey: 'refund-checkout-pi_checkout' },
    );
    expect(payment).toMatchObject({ status: 'REFUNDED', refundAmount: 82, stripeRefundId: 're_checkout' });
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: alice.id, dedupeKey: 'checkout-refund:pi_checkout' })],
      skipDuplicates: true,
    });
  });

  it('refunds a payment that lands after the session has started', async () => {
    jest.setSystemTime(NOW_AFTER_START);

    const result = await service.completeCheckout(paidCheckout() as any);

    expect(result.outcome).toBe('refunded');
    expect(db.timeSlot.updateMany).not.toHaveBeenCalled();
    expect(db.booking.create).not.toHaveBeenCalled();
  });

  it('keeps the payment refundable when Stripe refuses the refund, so the webhook retries', async () => {
    db.timeSlot.updateMany.mockResolvedValue({ count: 0 });
    refunds.create.mockRejectedValue(new Error('Stripe is down'));

    await expect(succeededWebhook(paidCheckout())).rejects.toThrow('Stripe is down');
    expect(payment).toMatchObject({ status: 'PENDING', refundAmount: null });
  });

  it('does not book when Stripe received less than the quoted total', async () => {
    const result = await service.completeCheckout(paidCheckout({ amount_received: 4000 }) as any);

    expect(result.outcome).toBe('refunded');
    expect(db.booking.create).not.toHaveBeenCalled();
  });
});

describe('Returning from Stripe after checkout', () => {
  it('creates the booking straight from Stripe when the webhook has not arrived', async () => {
    intents.retrieve.mockResolvedValue(paidCheckout());

    const res = await request(app)
      .post('/api/payments/checkout/confirm')
      .set('Authorization', tokenFor(alice))
      .send({ paymentIntentId: 'pi_checkout' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ outcome: 'paid', bookingId: 'booking-new', bookingRef: booking!.bookingRef });
  });

  it('reports processing, failed and unpaid checkouts without booking anything', async () => {
    intents.retrieve.mockResolvedValueOnce({ ...paidCheckout(), status: 'processing' });
    expect((await service.confirmCheckout(alice.id, 'pi_checkout')).outcome).toBe('processing');

    intents.retrieve.mockResolvedValueOnce({
      ...paidCheckout(),
      status: 'requires_payment_method',
      last_payment_error: { message: 'Card declined' },
    });
    expect((await service.confirmCheckout(alice.id, 'pi_checkout')).outcome).toBe('failed');
    expect(payment!.status).toBe('FAILED');

    intents.retrieve.mockResolvedValueOnce({ ...paidCheckout(), status: 'requires_payment_method' });
    expect((await service.confirmCheckout(alice.id, 'pi_checkout')).outcome).toBe('unpaid');

    expect(db.booking.create).not.toHaveBeenCalled();
  });

  it("returns 404 for someone else's checkout, before and after it is booked", async () => {
    intents.retrieve.mockResolvedValue(paidCheckout());
    await expect(service.confirmCheckout(bob.id, 'pi_checkout')).rejects.toMatchObject({ statusCode: 404 });
    expect(db.booking.create).not.toHaveBeenCalled();

    await service.confirmCheckout(alice.id, 'pi_checkout');
    await expect(service.confirmCheckout(bob.id, 'pi_checkout')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('requires login', async () => {
    const res = await request(app).post('/api/payments/checkout/confirm').send({ paymentIntentId: 'pi_checkout' });
    expect(res.status).toBe(401);
  });
});
