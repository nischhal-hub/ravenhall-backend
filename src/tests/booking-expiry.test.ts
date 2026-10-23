// Unpaid-hold expiry and late payments. Prisma is an in-memory store whose
// conditional updates and transactions (with rollback) behave like the real
// thing, so "released exactly once" is tested for real. Stripe/SMTP are mocked.

type Row = Record<string, any>;
const store = {
  bookings: [] as Row[],
  slots: new Map<string, Row>(),
  notifications: [] as Row[],
};
let nextId = 1;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('notIn' in cond) return !cond.notIn.includes(value);
      if ('not' in cond) return value !== cond.not;
      if ('lt' in cond) return value < cond.lt;
      if ('equals' in cond) return value === cond.equals;
    }
    return value === cond;
  });
}

jest.mock('../config/database', () => {
  const bookingView = (b: Row) => ({
    ...b,
    items: b.items.map((i: Row) => ({ ...i, slot: store.slots.get(i.slotId) })),
  });
  const prisma: any = {
    booking: {
      findMany: jest.fn(async ({ where, take, cursor }: Row) => {
        let rows = store.bookings.filter((b) => matches(b, where)).sort((a, b) => a.id.localeCompare(b.id));
        if (cursor) rows = rows.filter((b) => b.id > cursor.id);
        return rows.slice(0, take).map((b) => ({ id: b.id }));
      }),
      findFirst: jest.fn(async ({ where }: Row) => {
        const b = store.bookings.find((x) => matches(x, where));
        return b ? bookingView(b) : null;
      }),
      findUnique: jest.fn(async ({ where }: Row) => {
        const b = store.bookings.find((x) => x.id === where.id);
        return b ? bookingView(b) : null;
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = store.bookings.filter((b) => matches(b, where));
        rows.forEach((b) => Object.assign(b, data));
        return { count: rows.length };
      }),
    },
    timeSlot: {
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const ids: string[] = where.id.in;
        const rows = ids.map((id) => store.slots.get(id)!).filter((s) => {
          const { id: _id, ...rest } = where;
          return matches(s, rest);
        });
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      }),
    },
    payment: {
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = store.bookings.map((b) => b.payment).filter((p) => p && matches(p, where));
        rows.forEach((p) => Object.assign(p, data));
        return { count: rows.length };
      }),
    },
    notification: {
      createMany: jest.fn(async ({ data }: Row) => {
        let count = 0;
        for (const n of data) {
          if (store.notifications.some((x) => x.dedupeKey === n.dedupeKey)) continue;
          store.notifications.push({ id: `n${nextId++}`, createdAt: new Date(), ...n });
          count++;
        }
        return { count };
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = store.notifications.filter((n) => matches(n, where));
        rows.forEach((n) => Object.assign(n, data));
        return { count: rows.length };
      }),
    },
  };
  // In-realm deep copy (structuredClone yields Dates from another realm under Jest)
  const clone = (v: any): any =>
    v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
  // Snapshot → run → restore on throw, like a real transaction rollback.
  // Rows are restored in place so references held by tests stay live.
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
    const rows = [...store.bookings, ...store.bookings.map((b) => b.payment), ...store.slots.values()];
    const snapshot = rows.map(clone);
    try {
      return await fn(prisma);
    } catch (error) {
      rows.forEach((row, i) => Object.assign(row, snapshot[i]));
      throw error;
    }
  });
  return { prisma };
});
jest.mock('../config/stripe', () => ({
  stripe: {
    paymentIntents: { retrieve: jest.fn(), cancel: jest.fn() },
    refunds: { create: jest.fn() },
  },
}));
jest.mock('../config/email', () => ({
  transporter: { sendMail: jest.fn() },
  EMAIL_FROM: '"Ravenhall" <test@example.com>',
  isEmailEnabled: () => true,
}));

import { stripe } from '../config/stripe';
import { transporter } from '../config/email';
import { BookingExpiryService } from '../modules/bookings/booking-expiry.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { EXPIRED_HOLD_REASON } from '../modules/bookings/booking-hold';

const intents = stripe.paymentIntents as unknown as Record<string, jest.Mock>;
const refunds = stripe.refunds as unknown as Record<string, jest.Mock>;
const sendMail = transporter.sendMail as jest.Mock;
const expiry = new BookingExpiryService();
const payments = new PaymentsService();

// 11:45 local (Asia/Kathmandu) on 23 Oct 2026; the booked session is tomorrow
const NOW = new Date('2026-10-23T06:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function addBooking(overrides: Row = {}) {
  const id = overrides.id ?? `booking-${nextId++}`;
  const slotId = `slot-${id}`;
  store.slots.set(slotId, {
    id: slotId,
    date: new Date('2026-10-24T00:00:00.000Z'),
    startTime: '14:00',
    endTime: '15:00',
    isAvailable: false,
    isBlocked: false,
    lane: { name: 'Lane 1 — Batting' },
  });
  const booking = {
    id,
    bookingRef: `RIC-2026-${id}`,
    userId: 'user-alice',
    status: 'PENDING',
    source: 'ONLINE',
    finalAmount: 44,
    createdAt: minutesAgo(20),
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    user: { id: 'user-alice', email: 'alice@example.com', firstName: 'Alice' },
    payment: {
      id: `pay-${id}`,
      stripePaymentIntentId: `pi_${id}`,
      status: 'PENDING',
      amount: 44,
      paidAt: null,
    },
    items: [{ slotId }],
    ...overrides,
  };
  store.bookings.push(booking);
  return booking;
}

const expiredNotifications = () =>
  store.notifications.filter((n) => n.dedupeKey?.includes('booking-expired:'));

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
});

beforeEach(() => {
  store.bookings = [];
  store.slots = new Map();
  store.notifications = [];
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  intents.retrieve.mockImplementation(async (id: string) => ({ id, status: 'requires_payment_method' }));
  intents.cancel.mockImplementation(async (id: string) => ({ id, status: 'canceled' }));
  refunds.create.mockResolvedValue({ id: 're_1' });
  sendMail.mockResolvedValue({});
  delete process.env.UNPAID_HOLD_MINUTES;
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('Unpaid-hold expiry', () => {
  it('releases an unpaid online booking after 15 minutes, cancelling its Stripe payment', async () => {
    const booking = addBooking();

    const result = await expiry.runUnpaidExpiry(new Date());

    expect(result.expired).toBe(1);
    expect(booking.status).toBe('CANCELLED');
    expect(booking.cancellationReason).toBe(EXPIRED_HOLD_REASON);
    expect(booking.cancelledById).toBeNull();
    expect(store.slots.get(booking.items[0].slotId)!.isAvailable).toBe(true);
    expect(intents.cancel).toHaveBeenCalledWith(booking.payment.stripePaymentIntentId, undefined, {
      idempotencyKey: `expire-booking-${booking.id}`,
    });
    expect(expiredNotifications().map((n) => n.type).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].subject).toContain('Booking Expired');
  });

  it('keeps the hold for 15 minutes (UNPAID_HOLD_MINUTES is configurable)', async () => {
    const fresh = addBooking({ createdAt: minutesAgo(14) });
    await expiry.runUnpaidExpiry(new Date());
    expect(fresh.status).toBe('PENDING');

    process.env.UNPAID_HOLD_MINUTES = '10';
    await expiry.runUnpaidExpiry(new Date());
    expect(fresh.status).toBe('CANCELLED');
  });

  it('never releases confirmed, paid, or POS pay-at-counter bookings', async () => {
    const confirmed = addBooking({ status: 'CONFIRMED' });
    const paid = addBooking({ payment: { id: 'p', stripePaymentIntentId: 'pi_paid', status: 'SUCCEEDED', amount: 44 } });
    const pos = addBooking({ source: 'POS', payment: { id: 'p2', stripePaymentIntentId: null, status: 'PENDING', amount: 44 } });

    await expiry.runUnpaidExpiry(new Date());

    expect([confirmed.status, paid.status, pos.status]).toEqual(['CONFIRMED', 'PENDING', 'PENDING']);
    expect(store.notifications).toHaveLength(0);
  });

  it('confirms instead of expiring when Stripe already has the money', async () => {
    const booking = addBooking();
    intents.retrieve.mockResolvedValue({ id: booking.payment.stripePaymentIntentId, status: 'succeeded' });

    const result = await expiry.runUnpaidExpiry(new Date());

    expect(result.paid).toBe(1);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.payment.status).toBe('SUCCEEDED');
    expect(intents.cancel).not.toHaveBeenCalled();
  });

  it('confirms when the customer pays at the same moment the job cancels the payment', async () => {
    const booking = addBooking();
    intents.retrieve
      .mockResolvedValueOnce({ id: 'x', status: 'requires_payment_method' })
      .mockResolvedValueOnce({ id: booking.payment.stripePaymentIntentId, status: 'succeeded' });
    intents.cancel.mockRejectedValue(new Error('This PaymentIntent has already succeeded'));

    expect((await expiry.runUnpaidExpiry(new Date())).paid).toBe(1);
    expect(booking.status).toBe('CONFIRMED');
  });

  it('releases once and notifies once when the job runs twice or concurrently', async () => {
    const booking = addBooking();

    await Promise.all([expiry.runUnpaidExpiry(new Date()), expiry.runUnpaidExpiry(new Date())]);
    await expiry.runUnpaidExpiry(new Date());

    expect(booking.status).toBe('CANCELLED');
    expect(expiredNotifications()).toHaveLength(2); // one in-app + one email log
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('one failing booking does not stop the rest', async () => {
    const broken = addBooking({ id: 'a-broken' });
    const ok = addBooking({ id: 'b-ok' });
    intents.retrieve.mockImplementation(async (id: string) => {
      if (id === broken.payment.stripePaymentIntentId) throw new Error('Stripe unavailable');
      return { id, status: 'requires_payment_method' };
    });

    const result = await expiry.runUnpaidExpiry(new Date());

    expect(result).toMatchObject({ errors: 1, expired: 1 });
    expect(broken.status).toBe('PENDING'); // retried next run
    expect(ok.status).toBe('CANCELLED');
  });
});

describe('Payment arriving after expiry', () => {
  async function expire() {
    const booking = addBooking();
    await expiry.runUnpaidExpiry(new Date());
    expect(booking.status).toBe('CANCELLED');
    return booking;
  }
  const webhook = (booking: Row) =>
    payments.handleWebhookEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: booking.payment.stripePaymentIntentId, metadata: { bookingId: booking.id } } },
    } as any);

  it('re-claims the slot and confirms the booking when the slot is still free', async () => {
    const booking = await expire();

    await webhook(booking);

    expect(booking.status).toBe('CONFIRMED');
    expect(booking.cancellationReason).toBeNull();
    expect(store.slots.get(booking.items[0].slotId)!.isAvailable).toBe(false);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('refunds once and tells the customer when the slot was taken meanwhile', async () => {
    const booking = await expire();
    store.slots.get(booking.items[0].slotId)!.isAvailable = false; // someone else booked it

    await webhook(booking);
    await webhook(booking); // Stripe redelivery

    expect(booking.status).toBe('CANCELLED');
    expect(refunds.create).toHaveBeenCalledWith(
      { payment_intent: booking.payment.stripePaymentIntentId },
      { idempotencyKey: `refund-booking-${booking.id}` },
    );
    expect(booking.payment.status).toBe('REFUNDED');
    expect(store.notifications.filter((n) => n.dedupeKey === `booking-late-refund:${booking.id}`)).toHaveLength(1);
    expect(store.notifications.filter((n) => n.dedupeKey === `email:booking-late-refund:${booking.id}`)).toHaveLength(1);
  });
});
