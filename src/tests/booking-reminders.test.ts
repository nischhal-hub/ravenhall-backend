// Booking reminders (in-app + email, 1 hour before start).
// Prisma is replaced by a small in-memory store that enforces the unique
// notification dedupeKey, so idempotency is tested for real. SMTP is mocked.
import request from 'supertest';

type Row = Record<string, any>;
const store = {
  bookings: [] as Row[],
  notifications: [] as Row[],
};
let nextId = 1;

// Minimal matcher for the TimeSlot filters the reminders service builds
function slotMatches(slot: Row, where: Row): boolean {
  if (where.OR) return where.OR.some((w: Row) => slotMatches(slot, w));
  if (where.date && slot.date.getTime() !== where.date.getTime()) return false;
  const st = where.startTime ?? {};
  if (st.gt !== undefined && !(slot.startTime > st.gt)) return false;
  if (st.lte !== undefined && !(slot.startTime <= st.lte)) return false;
  return true;
}

function notificationMatches(n: Row, where: Row): boolean {
  if (where.dedupeKey !== undefined) {
    if (typeof where.dedupeKey === 'string' && n.dedupeKey !== where.dedupeKey) return false;
    if (where.dedupeKey?.in && !where.dedupeKey.in.includes(n.dedupeKey)) return false;
  }
  if (where.status && n.status !== where.status) return false;
  if (where.createdAt?.gte && n.createdAt < where.createdAt.gte) return false;
  return true;
}

jest.mock('../config/database', () => {
  const prisma: any = {
    booking: {
      findMany: jest.fn(async (args: Row) => {
        const slotWhere = args.where.items.some.slot;
        let rows = store.bookings
          .filter((b) => b.status === args.where.status)
          .filter((b) => b.items.some((i: Row) => slotMatches(i.slot, slotWhere)))
          .sort((a, b) => a.id.localeCompare(b.id));
        if (args.cursor) rows = rows.filter((b) => b.id > args.cursor.id);
        return rows.slice(0, args.take).map((b) => structuredClone(b));
      }),
      findFirst: jest.fn(async (args: Row) => {
        const b = store.bookings.find(
          (x) => x.id === args.where.id && x.status === args.where.status,
        );
        return b ? { items: b.items.map((i: Row) => ({ slotId: i.slotId })) } : null;
      }),
    },
    notification: {
      // ON CONFLICT (dedupeKey) DO NOTHING
      createMany: jest.fn(async (args: Row) => {
        let count = 0;
        for (const data of args.data) {
          if (store.notifications.some((n) => n.dedupeKey === data.dedupeKey)) continue;
          store.notifications.push({
            id: `n${nextId++}`,
            createdAt: new Date(),
            isRead: false,
            ...data,
          });
          count++;
        }
        return { count };
      }),
      updateMany: jest.fn(async (args: Row) => {
        const rows = store.notifications.filter((n) => notificationMatches(n, args.where));
        rows.forEach((n) => Object.assign(n, args.data));
        return { count: rows.length };
      }),
      findMany: jest.fn(async (args: Row) =>
        store.notifications.filter((n) => notificationMatches(n, args.where)),
      ),
    },
  };
  return { prisma };
});
jest.mock('../config/email', () => ({
  transporter: { sendMail: jest.fn() },
  EMAIL_FROM: '"Ravenhall" <test@example.com>',
  isEmailEnabled: () => true,
}));

import app from '../app';
import { transporter } from '../config/email';
import { RemindersService, reminderKeys } from '../modules/notifications/reminders.service';

const sendMail = transporter.sendMail as jest.Mock;
const service = new RemindersService();

// All times are Asia/Kathmandu (UTC+05:45). 2:00 PM local on 23 Oct 2026 = 08:15 UTC.
const DAY = new Date('2026-10-23T00:00:00.000Z');
const local = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 23, h, m) - (5 * 60 + 45) * 60_000);
};
const TWO_PM_UTC = '2026-10-23T08:15:00.000Z';

const makeBooking = (overrides: Row = {}) => ({
  id: 'booking-1',
  bookingRef: 'RIC-2026-00001',
  userId: 'user-alice',
  status: 'CONFIRMED',
  createdAt: new Date('2026-10-20T03:00:00.000Z'),
  user: { id: 'user-alice', email: 'alice@example.com', firstName: 'Alice' },
  payment: { paidAt: new Date('2026-10-20T03:05:00.000Z') },
  items: [
    {
      slotId: 'slot-14',
      slot: { date: DAY, startTime: '14:00', endTime: '15:00', lane: { name: 'Lane 1 — Batting' } },
    },
  ],
  ...overrides,
});

const inApp = () => store.notifications.filter((n) => n.type === 'IN_APP');
const emails = () => store.notifications.filter((n) => n.type === 'EMAIL');

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
  process.env.CLIENT_URL = 'https://app.example.com';
  delete process.env.REMINDER_LEAD_MINUTES;
});

beforeEach(() => {
  store.bookings = [];
  store.notifications = [];
  sendMail.mockReset();
  sendMail.mockResolvedValue({});
  // Only Date is faked: no real waiting, and promises still resolve normally
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});

afterEach(() => {
  jest.useRealTimers();
});

const runAt = (hhmm: string) => {
  jest.setSystemTime(local(hhmm));
  return service.runBookingReminders(new Date());
};

describe('Booking reminders', () => {
  it('sends exactly one in-app notification and one email at 1:00 PM for a 2:00 PM booking', async () => {
    store.bookings.push(makeBooking());

    const result = await runAt('13:00');

    expect(result.inAppCreated).toBe(1);
    expect(result.emails.sent).toBe(1);
    expect(inApp()).toHaveLength(1);
    expect(inApp()[0]).toMatchObject({
      userId: 'user-alice',
      isRead: false,
      dedupeKey: `booking-reminder:booking-1:${TWO_PM_UTC}`,
    });
    expect(emails()).toHaveLength(1);
    expect(emails()[0].status).toBe('SENT');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('alice@example.com');
  });

  it('shows the start time in Asia/Kathmandu local time (UTC+05:45)', async () => {
    store.bookings.push(makeBooking());

    await runAt('13:00');

    expect(inApp()[0].body).toBe(
      'Reminder: your booking at Lane 1 — Batting starts at 2:00 PM today.',
    );
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toContain('2:00 PM');
    expect(mail.text).toContain('Start time: 2:00 PM');
    expect(mail.text).toContain('Date: Fri, 23 Oct 2026');
    expect(mail.text).toContain('Duration: 1 hour');
    expect(mail.text).toContain('https://app.example.com/panel/bookings/booking-1');
    expect(mail.text).toContain('cancel');
  });

  it('does not send twice when the job runs again or two runs overlap', async () => {
    store.bookings.push(makeBooking());

    jest.setSystemTime(local('13:00'));
    await Promise.all([service.runBookingReminders(new Date()), service.runBookingReminders(new Date())]);
    await runAt('13:05');

    expect(inApp()).toHaveLength(1);
    expect(emails()).toHaveLength(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it.each(['CANCELLED', 'COMPLETED', 'PENDING'])('sends nothing for %s bookings', async (status) => {
    store.bookings.push(makeBooking({ status }));

    await runAt('13:00');

    expect(store.notifications).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends nothing when the booking is cancelled after it was picked up but before sending', async () => {
    store.bookings.push(makeBooking());
    const { prisma } = jest.requireMock('../config/database');
    // Cancel right after the batch read, before the send-time re-check
    prisma.booking.findMany.mockImplementationOnce(async (args: Row) => {
      const rows = store.bookings.filter((b) => b.status === args.where.status).map((b) => structuredClone(b));
      store.bookings[0].status = 'CANCELLED';
      return rows;
    });

    const result = await runAt('13:00');

    expect(result.skipped.changed).toBe(1);
    expect(store.notifications).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('follows a rescheduled booking to its new time and never fires for the old one', async () => {
    store.bookings.push(makeBooking());
    // Rescheduled from 2:00 PM to 4:00 PM before any reminder went out
    store.bookings[0].items = [
      {
        slotId: 'slot-16',
        slot: { date: DAY, startTime: '16:00', endTime: '17:00', lane: { name: 'Lane 1 — Batting' } },
      },
    ];

    await runAt('13:00');
    expect(store.notifications).toHaveLength(0);

    await runAt('15:00');
    expect(inApp()).toHaveLength(1);
    expect(inApp()[0].dedupeKey).toBe(reminderKeys('booking-1', local('16:00')).inApp);
    expect(inApp()[0].body).toContain('4:00 PM');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('skips a booking made 30 minutes before it starts', async () => {
    store.bookings.push(
      makeBooking({ createdAt: local('13:30'), payment: { paidAt: local('13:31') } }),
    );

    const result = await runAt('13:35');

    expect(result.skipped['booked-late']).toBe(1);
    expect(store.notifications).toHaveLength(0);
  });

  it('still sends on a delayed run at 1:10 PM, but not after the session has started', async () => {
    store.bookings.push(makeBooking());
    store.bookings.push(makeBooking({ id: 'booking-2', bookingRef: 'RIC-2026-00002' }));

    await runAt('13:10');
    expect(inApp().map((n) => n.dedupeKey)).toEqual([
      `booking-reminder:booking-1:${TWO_PM_UTC}`,
      `booking-reminder:booking-2:${TWO_PM_UTC}`,
    ]);

    store.notifications = [];
    sendMail.mockClear();
    await runAt('14:01');
    expect(store.notifications).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send before the reminder is due', async () => {
    store.bookings.push(makeBooking());

    await runAt('12:50');

    expect(store.notifications).toHaveLength(0);
  });

  it('records a failed email as FAILED without breaking the run, and retries it once later', async () => {
    store.bookings.push(makeBooking());
    store.bookings.push(makeBooking({ id: 'booking-2', bookingRef: 'RIC-2026-00002', user: { id: 'user-bob', email: 'bob@example.com', firstName: 'Bob' }, userId: 'user-bob' }));
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await runAt('13:00');

    expect(result.errors).toBe(0);
    expect(result.emails).toMatchObject({ failed: 1, sent: 1 });
    expect(inApp()).toHaveLength(2);
    expect(emails().map((e) => e.status).sort()).toEqual(['FAILED', 'SENT']);

    // The next run retries the failed one only
    await runAt('13:05');
    expect(emails().every((e) => e.status === 'SENT')).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('stops retrying a failed email after the retry window', async () => {
    store.bookings.push(makeBooking());
    sendMail.mockRejectedValue(new Error('SMTP down'));

    await runAt('13:00');
    await runAt('13:20');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(emails()[0].status).toBe('FAILED');
  });

  it('skips POS guests entirely and sends only the in-app notification when there is no email', async () => {
    store.bookings.push(
      makeBooking({ user: { id: 'guest-1', email: 'guest_1@guest.ravenhall.com', firstName: 'Walk-in' }, userId: 'guest-1' }),
    );
    store.bookings.push(
      makeBooking({ id: 'booking-2', user: { id: 'user-carol', email: '', firstName: 'Carol' }, userId: 'user-carol' }),
    );

    const result = await runAt('13:00');

    expect(result.skipped.guest).toBe(1);
    expect(inApp().map((n) => n.userId)).toEqual(['user-carol']);
    expect(emails()).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('respects REMINDER_LEAD_MINUTES', async () => {
    process.env.REMINDER_LEAD_MINUTES = '30';
    store.bookings.push(makeBooking());

    await runAt('13:00');
    expect(store.notifications).toHaveLength(0);
    await runAt('13:30');
    expect(inApp()).toHaveLength(1);

    delete process.env.REMINDER_LEAD_MINUTES;
  });

  it('escapes user-controlled text in the HTML email', async () => {
    store.bookings.push(
      makeBooking({ user: { id: 'user-x', email: 'x@example.com', firstName: '<b>Eve</b>' }, userId: 'user-x' }),
    );

    await runAt('13:00');

    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(html).not.toContain('<b>Eve</b>');
  });
});

describe('Reminder job endpoint', () => {
  const url = '/api/internal/jobs/booking-reminders';

  beforeAll(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });
  afterAll(() => {
    delete process.env.CRON_SECRET;
  });

  it('returns 401 without the secret', async () => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong secret', async () => {
    const res = await request(app).post(url).set('x-cron-secret', 'nope');
    expect(res.status).toBe(401);
  });

  it('runs the job with a Bearer secret (Vercel Cron) or the x-cron-secret header', async () => {
    jest.setSystemTime(local('13:00'));
    store.bookings.push(makeBooking());

    const viaBearer = await request(app).get(url).set('Authorization', 'Bearer test-cron-secret');
    const viaHeader = await request(app).post(url).set('x-cron-secret', 'test-cron-secret');

    expect(viaBearer.status).toBe(200);
    expect(viaBearer.body.data.inAppCreated).toBe(1);
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.inAppCreated).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('rejects everything when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).get(url).set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
    process.env.CRON_SECRET = 'test-cron-secret';
  });
});
