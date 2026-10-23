// Lifecycle flows (registration notification, booking scoping, cancel, emails).
// Prisma, Stripe and SMTP are mocked so this suite needs no database and sends no mail.
import request from 'supertest';
import { Prisma } from '@prisma/client';

jest.mock('../config/database', () => {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    booking: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    timeSlot: { updateMany: jest.fn() },
    payment: { update: jest.fn() },
    notification: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../config/stripe', () => ({
  stripe: { refunds: { create: jest.fn() } },
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
import { EmailService } from '../modules/notifications/email.service';

const db = prisma as any;
const sendMail = transporter.sendMail as jest.Mock;
const refundCreate = stripe.refunds.create as jest.Mock;

// Lets fire-and-forget email promises settle before asserting
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

const users = {
  alice: { id: 'user-alice', email: 'alice@example.com', role: 'CUSTOMER' as const, firstName: 'Alice' },
  bob: { id: 'user-bob', email: 'bob@example.com', role: 'CUSTOMER' as const, firstName: 'Bob' },
  admin: { id: 'user-admin', email: 'admin@example.com', role: 'ADMIN' as const, firstName: 'Ada' },
};
const tokenFor = (u: (typeof users)[keyof typeof users]) =>
  `Bearer ${generateAccessToken({ userId: u.id, email: u.email, role: u.role })}`;

const makeBooking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  bookingRef: 'RIC-2026-00001',
  userId: users.alice.id,
  status: 'CONFIRMED',
  finalAmount: 40,
  items: [{ slotId: 'slot-1' }],
  payment: null,
  ...overrides,
});

const bookingForEmail = (status = 'CANCELLED') => ({
  ...makeBooking({ status }),
  user: { id: users.alice.id, email: users.alice.email, firstName: 'Alice' },
  items: [
    {
      slotId: 'slot-1',
      slot: { date: new Date('2026-11-20'), startTime: '10:00', endTime: '11:00', lane: { name: 'Lane 1' } },
    },
  ],
});

beforeEach(() => {
  // authenticate() resolves users by id; register() checks by email
  db.user.findUnique.mockImplementation(({ where }: any) => {
    const u = Object.values(users).find((x) => x.id === where.id);
    return Promise.resolve(u ? { id: u.id, email: u.email, role: u.role } : null);
  });
  db.notification.createMany.mockResolvedValue({ count: 1 });
  db.notification.updateMany.mockResolvedValue({ count: 1 });
  db.timeSlot.updateMany.mockResolvedValue({ count: 1 });
  db.booking.findUnique.mockResolvedValue(bookingForEmail());
  sendMail.mockResolvedValue({});
});

afterEach(() => {
  jest.resetAllMocks();
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
});

// ── Task 1: welcome notification ───────────────────────────────────────────
describe('Registration welcome notification', () => {
  const payload = {
    email: 'new@example.com',
    password: 'Test@1234',
    firstName: 'Nina',
    lastName: 'New',
  };

  it('creates exactly one unread IN_APP welcome notification in the same transaction', async () => {
    db.user.create.mockResolvedValue({ id: 'user-new', email: payload.email, firstName: 'Nina', lastName: 'New', role: 'CUSTOMER' });

    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = db.notification.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data[0]).toMatchObject({ userId: 'user-new', type: 'IN_APP', dedupeKey: 'welcome:user-new' });
    expect(data[0].isRead).toBeUndefined(); // defaults to unread
  });

  it('returns 409 (not 500) when a concurrent double-submit loses the unique email race', async () => {
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' }),
    );

    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email already registered');
  });

  it('still registers when the verification email fails to send', async () => {
    db.user.create.mockResolvedValue({ id: 'user-new', email: payload.email, firstName: 'Nina', lastName: 'New', role: 'CUSTOMER' });
    sendMail.mockRejectedValue(new Error('SMTP down'));

    const res = await request(app).post('/api/auth/register').send(payload);
    await flush();

    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalled();
  });
});

// ── Task 2: server-side scoping ────────────────────────────────────────────
describe('Booking scoping', () => {
  it('forbids customers from listing all bookings', async () => {
    const res = await request(app).get('/api/bookings').set('Authorization', tokenFor(users.alice));
    expect(res.status).toBe(403);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it('scopes /bookings/my to the authenticated user', async () => {
    db.booking.findMany.mockResolvedValue([]);
    db.booking.count.mockResolvedValue(0);

    const res = await request(app).get('/api/bookings/my').set('Authorization', tokenFor(users.bob));

    expect(res.status).toBe(200);
    expect(db.booking.findMany.mock.calls[0][0].where).toMatchObject({ userId: users.bob.id });
  });

  it("returns 404 when a customer requests another user's booking", async () => {
    db.booking.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/bookings/booking-1').set('Authorization', tokenFor(users.bob));

    expect(res.status).toBe(404);
    expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ id: 'booking-1', userId: users.bob.id });
  });

  it('lets staff read any booking', async () => {
    db.booking.findFirst.mockResolvedValue(makeBooking());

    const res = await request(app).get('/api/bookings/booking-1').set('Authorization', tokenFor(users.admin));

    expect(res.status).toBe(200);
    expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ id: 'booking-1' });
  });

  it('forbids customers from changing status or deleting bookings', async () => {
    const status = await request(app)
      .patch('/api/bookings/booking-1/status')
      .set('Authorization', tokenFor(users.alice))
      .send({ status: 'COMPLETED' });
    const del = await request(app).delete('/api/bookings/booking-1').set('Authorization', tokenFor(users.alice));

    expect(status.status).toBe(403);
    expect(del.status).toBe(403);
  });
});

// ── Task 3: admin cancel ───────────────────────────────────────────────────
describe('Admin cancel', () => {
  const cancel = (as: (typeof users)[keyof typeof users] = users.admin, body: object = { reason: 'Lane maintenance' }) =>
    request(app).patch('/api/admin/bookings/booking-1/cancel').set('Authorization', tokenFor(as)).send(body);

  it('cancels, releases the slot, records who/why, notifies in-app and emails the user', async () => {
    db.booking.findFirst.mockResolvedValue(makeBooking());
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));

    const res = await cancel();
    await flush();

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: { in: ['PENDING', 'CONFIRMED'] } },
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancelledById: users.admin.id,
        cancellationReason: 'Lane maintenance',
      }),
    });
    expect(db.timeSlot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['slot-1'] } },
      data: { isAvailable: true },
    });

    const inApp = db.notification.createMany.mock.calls
      .map((c: any) => c[0].data[0])
      .find((n: any) => n.type === 'IN_APP');
    expect(inApp).toMatchObject({
      userId: users.alice.id,
      dedupeKey: 'booking-cancelled:booking-1',
    });
    expect(inApp.body).toContain('Your booking #RIC-2026-00001 has been cancelled');

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe(users.alice.email);
    expect(mail.subject).toBe('Booking Cancelled — RIC-2026-00001');
    expect(mail.text).toContain('cancelled by our staff');
    expect(mail.text).toContain('Reason: Lane maintenance');
  });

  it.each(['CANCELLED', 'COMPLETED'])('rejects cancelling a %s booking with 409', async (status) => {
    db.booking.findFirst.mockResolvedValue(makeBooking({ status }));

    const res = await cancel();

    expect(res.status).toBe(409);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent request already cancelled it, reusing the same idempotent refund', async () => {
    db.booking.findFirst.mockResolvedValue(
      makeBooking({ payment: { id: 'pay-1', status: 'SUCCEEDED', stripePaymentIntentId: 'pi_1', amount: 40 } }),
    );
    db.booking.updateMany.mockResolvedValue({ count: 0 });
    refundCreate.mockResolvedValue({ id: 're_1' });

    const res = await cancel();
    await flush();

    expect(res.status).toBe(409);
    // Same key as the winning request, so Stripe returns the existing refund
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: 'refund-booking-booking-1' },
    );
    expect(db.payment.update).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns 502 and leaves the booking untouched when the Stripe refund fails', async () => {
    db.booking.findFirst.mockResolvedValue(
      makeBooking({ payment: { id: 'pay-1', status: 'SUCCEEDED', stripePaymentIntentId: 'pi_1', amount: 40 } }),
    );
    refundCreate.mockRejectedValue(new Error('card_declined'));

    const res = await cancel();

    expect(res.status).toBe(502);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it('refunds Stripe payments with an idempotency key', async () => {
    db.booking.findFirst.mockResolvedValue(
      makeBooking({ payment: { id: 'pay-1', status: 'SUCCEEDED', stripePaymentIntentId: 'pi_1', amount: 40 } }),
    );
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));
    refundCreate.mockResolvedValue({ id: 're_1' });

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: 'refund-booking-booking-1' },
    );
    expect(db.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'REFUNDED', stripeRefundId: 're_1', refundAmount: 40 },
    });
  });

  it('succeeds even when the cancellation email fails, and records the failure', async () => {
    db.booking.findFirst.mockResolvedValue(makeBooking());
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));
    sendMail.mockRejectedValue(new Error('SMTP down'));

    const res = await cancel();
    await flush();

    expect(res.status).toBe(200);
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'email:booking-cancelled:booking-1' },
      data: { status: 'FAILED' },
    });
  });

  it('forbids customers from using the admin cancel endpoint', async () => {
    const res = await cancel(users.alice);
    expect(res.status).toBe(403);
  });

  it("does not let a customer cancel someone else's booking", async () => {
    db.booking.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/bookings/booking-1/cancel')
      .set('Authorization', tokenFor(users.bob));

    expect(res.status).toBe(404);
    expect(db.booking.findFirst.mock.calls[0][0].where).toEqual({ id: 'booking-1', userId: users.bob.id });
  });

  it('routes status=CANCELLED through the same cancel path', async () => {
    db.booking.findFirst.mockResolvedValue(makeBooking());
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue(makeBooking({ status: 'CANCELLED' }));

    const res = await request(app)
      .patch('/api/admin/bookings/booking-1/status')
      .set('Authorization', tokenFor(users.admin))
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(200);
    expect(db.timeSlot.updateMany).toHaveBeenCalled();
    expect(db.booking.updateMany.mock.calls[0][0].data.cancelledById).toBe(users.admin.id);
  });

  it('rejects invalid status transitions and unknown statuses', async () => {
    db.booking.findUnique.mockResolvedValue(makeBooking({ status: 'COMPLETED' }));
    const invalid = await request(app)
      .patch('/api/admin/bookings/booking-1/status')
      .set('Authorization', tokenFor(users.admin))
      .send({ status: 'PENDING' });
    const unknown = await request(app)
      .patch('/api/admin/bookings/booking-1/status')
      .set('Authorization', tokenFor(users.admin))
      .send({ status: 'ARCHIVED' });

    expect(invalid.status).toBe(409);
    expect(unknown.status).toBe(400);
  });
});

// ── Task 4: email triggers ─────────────────────────────────────────────────
describe('Transactional emails', () => {
  it('sends a confirmation email with booking details when staff confirm a booking', async () => {
    db.booking.findUnique
      .mockResolvedValueOnce(makeBooking({ status: 'PENDING' })) // status check
      .mockResolvedValue(bookingForEmail('CONFIRMED')); // email details
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findUniqueOrThrow.mockResolvedValue(makeBooking());

    const res = await request(app)
      .patch('/api/admin/bookings/booking-1/status')
      .set('Authorization', tokenFor(users.admin))
      .send({ status: 'CONFIRMED' });
    await flush();

    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Booking Confirmed — RIC-2026-00001');
    expect(mail.text).toContain('Thank you for booking');
    expect(mail.text).toContain('Lane: Lane 1');
    expect(mail.html).toContain('RIC-2026-00001');
  });

  it('does not resend when the same event is replayed (e.g. Stripe webhook retry)', async () => {
    db.booking.findUnique.mockResolvedValue(bookingForEmail('CONFIRMED'));
    db.notification.createMany.mockResolvedValue({ count: 0 }); // dedupeKey already exists

    await new EmailService().sendBookingConfirmation({ id: 'booking-1' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips placeholder guest addresses', async () => {
    db.booking.findUnique.mockResolvedValue({
      ...bookingForEmail('CONFIRMED'),
      user: { id: 'guest', email: 'walkin-1@guest.ravenhall.com', firstName: 'Guest' },
    });

    await new EmailService().sendBookingConfirmation({ id: 'booking-1' });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('escapes user-supplied text in HTML emails', async () => {
    db.booking.findUnique.mockResolvedValue(bookingForEmail());

    await new EmailService().sendBookingCancellation('booking-1', {
      cancelledBy: 'staff',
      reason: '<script>alert(1)</script>',
    });

    expect(sendMail.mock.calls[0][0].html).not.toContain('<script>');
    expect(sendMail.mock.calls[0][0].html).toContain('&lt;script&gt;');
  });
});

// ── Notifications API ──────────────────────────────────────────────────────
describe('Notifications API', () => {
  it('returns only the user’s in-app notifications with an unread count', async () => {
    db.notification.findMany.mockResolvedValue([]);
    db.notification.count.mockResolvedValue(1);

    const res = await request(app).get('/api/notifications/my').set('Authorization', tokenFor(users.alice));

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(1);
    expect(db.notification.findMany.mock.calls[0][0].where).toEqual({ userId: users.alice.id, type: 'IN_APP' });
  });

  it("cannot mark another user's notification as read", async () => {
    db.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .patch('/api/notifications/notif-1/read')
      .set('Authorization', tokenFor(users.bob));

    expect(res.status).toBe(404);
    expect(db.notification.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'notif-1', userId: users.bob.id });
  });
});
