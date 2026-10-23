// Payment intents, resuming an unfinished checkout, and confirming on return.
// Prisma, Stripe and SMTP are mocked, so this suite needs no database or network.
import request from 'supertest';

jest.mock('../config/database', () => {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    booking: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    payment: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    timeSlot: { updateMany: jest.fn() },
    notification: { createMany: jest.fn(), updateMany: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../config/stripe', () => ({
  stripe: {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    },
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
import { transporter } from '../config/email';
import { generateAccessToken } from '../utils/jwt';
import { PaymentsService } from '../modules/payments/payments.service';

const db = prisma as any;
const intents = stripe.paymentIntents as unknown as Record<string, jest.Mock>;
const service = new PaymentsService();

const alice = { id: 'user-alice', email: 'alice@example.com', role: 'CUSTOMER' as const };
const bob = { id: 'user-bob', email: 'bob@example.com', role: 'CUSTOMER' as const };
const tokenFor = (u: typeof alice) =>
  `Bearer ${generateAccessToken({ userId: u.id, email: u.email, role: u.role })}`;

// Asia/Kathmandu (UTC+05:45): 2:00 PM on 23 Oct 2026 is 08:15 UTC
const NOW_BEFORE = new Date('2026-10-23T06:00:00.000Z'); // 11:45 AM local
const NOW_AFTER_START = new Date('2026-10-23T08:20:00.000Z'); // 2:05 PM local

const pendingBooking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  bookingRef: 'RIC-2026-00001',
  userId: alice.id,
  status: 'PENDING',
  finalAmount: 44,
  payment: null as unknown,
  items: [{ slot: { date: new Date('2026-10-23T00:00:00.000Z'), startTime: '14:00' } }],
  ...overrides,
});

const openPayment = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1',
  stripePaymentIntentId: 'pi_old',
  status: 'PENDING',
  amount: 44,
  paidAt: null,
  ...overrides,
});

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_BEFORE, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  db.user.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve([alice, bob].find((u) => u.id === where.id) ?? null),
  );
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.booking.updateMany.mockResolvedValue({ count: 1 });
  db.booking.findUnique.mockResolvedValue({ id: 'booking-1', userId: alice.id, bookingRef: 'RIC-2026-00001' });
  db.notification.createMany.mockResolvedValue({ count: 1 });
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  (transporter.sendMail as jest.Mock).mockResolvedValue({});
  intents.create.mockResolvedValue({ id: 'pi_new', client_secret: 'secret_new', amount: 4400, status: 'requires_payment_method' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

describe('Starting or resuming a payment', () => {
  it('creates a PaymentIntent and a PENDING payment the first time', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking());

    const result = await service.createPaymentIntent(alice.id, 'booking-1');

    expect(result).toEqual({ clientSecret: 'secret_new', amount: 44, currency: 'aud' });
    expect(intents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 4400 }));
    expect(db.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookingId: 'booking-1', stripePaymentIntentId: 'pi_new', status: 'PENDING' }),
    });
  });

  it('resumes the same PaymentIntent after the customer left checkout', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 4400, status: 'requires_payment_method' });

    const result = await service.createPaymentIntent(alice.id, 'booking-1');

    expect(result.clientSecret).toBe('secret_old');
    expect(intents.create).not.toHaveBeenCalled();
    expect(intents.update).not.toHaveBeenCalled();
  });

  it('keeps the Stripe amount in sync with the booking total', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ finalAmount: 50, payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 4400, status: 'requires_payment_method' });
    intents.update.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 5000, status: 'requires_payment_method' });

    const result = await service.createPaymentIntent(alice.id, 'booking-1');

    expect(intents.update).toHaveBeenCalledWith('pi_old', { amount: 5000 });
    expect(db.payment.update).toHaveBeenCalledWith({ where: { id: 'payment-1' }, data: { amount: 50 } });
    expect(result.amount).toBe(50);
  });

  it('replaces a PaymentIntent that Stripe cancelled, reusing the payment row', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 4400, status: 'canceled' });

    const result = await service.createPaymentIntent(alice.id, 'booking-1');

    expect(result.clientSecret).toBe('secret_new');
    expect(db.payment.create).not.toHaveBeenCalled();
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: expect.objectContaining({ stripePaymentIntentId: 'pi_new', status: 'PENDING' }),
    });
  });

  it('confirms instead of charging again when Stripe already has the payment', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 4400, status: 'succeeded' });

    await expect(service.createPaymentIntent(alice.id, 'booking-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    expect(intents.create).not.toHaveBeenCalled();
  });

  it('refuses while a previous attempt is still processing', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', client_secret: 'secret_old', amount: 4400, status: 'processing' });

    await expect(service.createPaymentIntent(alice.id, 'booking-1')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses once the session has started (Asia/Kathmandu time)', async () => {
    jest.setSystemTime(NOW_AFTER_START);
    db.booking.findFirst.mockResolvedValue(pendingBooking());

    await expect(service.createPaymentIntent(alice.id, 'booking-1')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('already started'),
    });
    expect(intents.create).not.toHaveBeenCalled();
  });

  it("returns 404 for someone else's booking or one that isn't pending", async () => {
    db.booking.findFirst.mockResolvedValue(null);
    await expect(service.createPaymentIntent(bob.id, 'booking-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Confirming on return from Stripe', () => {
  it('confirms the booking straight from Stripe when the webhook has not arrived', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', status: 'succeeded' });

    const result = await service.confirmPayment(alice.id, 'booking-1');

    expect(result.outcome).toBe('paid');
    expect(db.payment.updateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: 'pi_old', status: { not: 'SUCCEEDED' } },
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    });
    expect(db.notification.createMany).toHaveBeenCalled(); // booking-confirmed notification
  });

  it('reports processing and failed payments', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValueOnce({ id: 'pi_old', status: 'processing' });
    expect((await service.confirmPayment(alice.id, 'booking-1')).outcome).toBe('processing');

    intents.retrieve.mockResolvedValueOnce({
      id: 'pi_old',
      status: 'requires_payment_method',
      last_payment_error: { message: 'Card declined' },
    });
    expect((await service.confirmPayment(alice.id, 'booking-1')).outcome).toBe('failed');
  });

  it('reports unpaid when checkout was opened but nothing was attempted', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking({ payment: openPayment() }));
    intents.retrieve.mockResolvedValue({ id: 'pi_old', status: 'requires_payment_method', last_payment_error: null });

    expect((await service.confirmPayment(alice.id, 'booking-1')).outcome).toBe('unpaid');
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it('never revives a booking that was cancelled while paying', async () => {
    db.booking.updateMany.mockResolvedValue({ count: 0 }); // no longer PENDING
    db.booking.findUnique.mockResolvedValue({ status: 'CANCELLED' });

    await service.handleWebhookEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_old', metadata: { bookingId: 'booking-1' } } },
    } as any);

    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('Payment routes', () => {
  it('POST /api/payments/confirm requires login and is scoped to the owner', async () => {
    const anon = await request(app).post('/api/payments/confirm').send({ bookingId: 'booking-1' });
    expect(anon.status).toBe(401);

    db.booking.findFirst.mockResolvedValue(null); // not Bob's booking
    const other = await request(app)
      .post('/api/payments/confirm')
      .set('Authorization', tokenFor(bob))
      .send({ bookingId: 'booking-1' });
    expect(other.status).toBe(404);
    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'booking-1', userId: bob.id } }),
    );
  });

  it('POST /api/payments/intent returns the amount to show the customer', async () => {
    db.booking.findFirst.mockResolvedValue(pendingBooking());

    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', tokenFor(alice))
      .send({ bookingId: 'booking-1' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ clientSecret: 'secret_new', amount: 44, currency: 'aud' });
  });
});

describe('Cancelling an unpaid booking', () => {
  it('closes its open Stripe payment so it cannot be paid afterwards', async () => {
    const booking = { ...pendingBooking({ payment: openPayment() }), items: [{ slotId: 'slot-1' }] };
    db.booking.findFirst.mockResolvedValue(booking);
    db.timeSlot.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'CANCELLED' });
    db.booking.findUnique.mockResolvedValue(null); // email lookup; nothing to send
    intents.cancel.mockResolvedValue({ id: 'pi_old', status: 'canceled' });

    const res = await request(app)
      .patch('/api/bookings/booking-1/cancel')
      .set('Authorization', tokenFor(alice))
      .send({});
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

    expect(res.status).toBe(200);
    expect(intents.cancel).toHaveBeenCalledWith('pi_old');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
});
