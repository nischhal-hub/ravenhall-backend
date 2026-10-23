// Admin user detail, resend-verification, started-slot rule and scheduler auth.
// Prisma, Stripe and SMTP are mocked so this suite needs no database and sends no mail.
import request from 'supertest';

type Row = Record<string, any>;
const users: Row[] = [];

jest.mock('../config/database', () => {
  const pick = (row?: Row) => (row ? { ...row } : null);
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: Row) => pick(users.find((u) => u.id === where.id))),
      findFirst: jest.fn(async ({ where }: Row) => {
        if (where.emailVerifyToken) return pick(users.find((u) => u.emailVerifyToken === where.emailVerifyToken));
        const email = String(where.email.equals).toLowerCase();
        return pick(users.find((u) => u.email.toLowerCase() === email));
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = users.filter(
          (u) => u.id === where.id && (where.isEmailVerified === undefined || u.isEmailVerified === where.isEmailVerified),
        );
        rows.forEach((u) => Object.assign(u, data));
        return { count: rows.length };
      }),
    },
    timeSlot: { findUnique: jest.fn() },
    booking: { findFirst: jest.fn() },
    jobRun: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn(async () => []) },
    notification: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../config/stripe', () => ({ stripe: {} }));
jest.mock('../config/email', () => ({
  transporter: { sendMail: jest.fn() },
  EMAIL_FROM: '"Ravenhall" <test@example.com>',
  isEmailEnabled: () => true,
}));

import app from '../app';
import { prisma } from '../config/database';
import { transporter } from '../config/email';
import { generateAccessToken } from '../utils/jwt';
import { resetResendVerificationLimits } from '../middleware/rateLimiter.middleware';
import { SLOT_STARTED_MESSAGE } from '../modules/bookings/bookings.service';

const db = prisma as any;
const sendMail = transporter.sendMail as jest.Mock;
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

const admin = { id: 'u-admin', email: 'admin@example.com', role: 'ADMIN', firstName: 'Ada' };
const staff = { id: 'u-staff', email: 'staff@example.com', role: 'STAFF', firstName: 'Sam' };
const customer = {
  id: 'u-cust',
  email: 'Casey@Example.com',
  role: 'CUSTOMER',
  firstName: 'Casey',
  lastName: 'Lee',
  phone: null,
  password: '$2a$12$hash-that-must-never-leak',
  emailVerifyToken: '111111',
  resetToken: 'reset-secret',
  isEmailVerified: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};
const bearer = (u: Row) => `Bearer ${generateAccessToken({ userId: u.id, email: u.email, role: u.role as any })}`;

beforeAll(() => {
  process.env.BUSINESS_TIMEZONE = 'Asia/Kathmandu';
});

beforeEach(async () => {
  users.length = 0;
  users.push({ ...admin }, { ...staff }, { ...customer });
  sendMail.mockResolvedValue({});
  await resetResendVerificationLimits();
});

describe('GET /api/admin/users/:id', () => {
  const detail = {
    id: customer.id,
    email: customer.email,
    firstName: 'Casey',
    lastName: 'Lee',
    phone: null,
    role: 'CUSTOMER',
    isEmailVerified: false,
    createdAt: customer.createdAt,
    membership: null,
    _count: { bookings: 1 },
    bookings: [
      {
        id: 'b1',
        bookingRef: 'RIC-2026-0001',
        status: 'CONFIRMED',
        source: 'ONLINE',
        finalAmount: 44,
        createdAt: new Date(),
        items: [{ slot: { date: new Date('2026-10-24T00:00:00Z'), startTime: '14:00', endTime: '15:00', lane: { name: 'Lane 1' } } }],
      },
    ],
  };
  // The detail query has a `select`; the auth middleware's lookup selects only id/email/role
  const mockDetail = (result: Row | null) =>
    db.user.findUnique.mockImplementation(async ({ where, select }: Row) =>
      select?._count ? result : users.find((u) => u.id === where.id),
    );

  it('returns the profile, membership and recent bookings for admin and staff, without secrets', async () => {
    mockDetail(detail);
    for (const viewer of [admin, staff]) {
      const res = await request(app).get(`/api/admin/users/${customer.id}`).set('Authorization', bearer(viewer));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: customer.id,
        bookingCount: 1,
        recentBookings: [{ bookingRef: 'RIC-2026-0001', laneName: 'Lane 1', startTime: '14:00' }],
      });
      const body = JSON.stringify(res.body);
      for (const secret of ['password', 'emailVerifyToken', 'resetToken', 'hash-that-must-never-leak']) {
        expect(body).not.toContain(secret);
      }
    }
    // Secrets are never selected in the first place
    const select = db.user.findUnique.mock.calls.find(([a]: Row[]) => a.select?._count)[0].select;
    expect(select).not.toHaveProperty('password');
    expect(select).not.toHaveProperty('emailVerifyToken');
    expect(select).not.toHaveProperty('resetToken');
  });

  it('returns 404 for an unknown user', async () => {
    mockDetail(null);
    const res = await request(app).get('/api/admin/users/nope').set('Authorization', bearer(admin));
    expect(res.status).toBe(404);
  });

  it('is forbidden to customers', async () => {
    mockDetail(detail);
    const res = await request(app).get(`/api/admin/users/${customer.id}`).set('Authorization', bearer(customer));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/resend-verification', () => {
  // supertest always connects from one address (the app doesn't trust
  // X-Forwarded-For), so every request here shares the per-IP limiters too.
  const resend = (email: string) => request(app).post('/api/auth/resend-verification').send({ email });

  it('replaces the code: the new one verifies, the old one no longer does', async () => {
    const res = await resend('casey@example.com'); // any casing
    await flush();
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const newCode = users.find((u) => u.id === customer.id)!.emailVerifyToken;
    expect(newCode).toMatch(/^\d{6}$/);
    expect(newCode).not.toBe('111111');
    expect(sendMail.mock.calls[0][0].html).toContain(newCode);

    const old = await request(app).get('/api/auth/verify-email/111111');
    expect(old.status).toBe(400);
    const ok = await request(app).get(`/api/auth/verify-email/${newCode}`);
    expect(ok.status).toBe(200);
    expect(users.find((u) => u.id === customer.id)!.isEmailVerified).toBe(true);
  });

  it('answers identically for unknown, verified and unverified emails', async () => {
    users.push({ ...customer, id: 'u-verified', email: 'done@example.com', isEmailVerified: true });
    const responses = [];
    for (const email of ['casey@example.com', 'nobody@example.com', 'done@example.com']) {
      await resetResendVerificationLimits();
      responses.push(await resend(email));
    }
    await flush();
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual(responses[0].body);
    }
    expect(sendMail).toHaveBeenCalledTimes(1); // only the unverified account gets mail
  });

  it('allows one request per minute, answering 429 with Retry-After', async () => {
    expect((await resend('casey@example.com')).status).toBe(200);
    const limited = await resend('CASEY@example.com');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(limited.body.message).toMatch(/wait \d+ seconds/);
    // A different email from the same address is limited too (per-IP)
    expect((await resend('someone-else@example.com')).status).toBe(429);
  });

  it('allows at most 5 per hour, even when spaced a minute apart', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      for (let i = 0; i < 5; i++) {
        expect((await resend('casey@example.com')).status).toBe(200);
        jest.advanceTimersByTime(61_000);
      }
      const limited = await resend('casey@example.com');
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(60);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never logs the code', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    await resend('casey@example.com');
    await flush();
    const code = users.find((u) => u.id === customer.id)!.emailVerifyToken;
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
      spy.mockRestore();
    }
  });
});

describe('Slots that have already started', () => {
  // 14:00 Kathmandu on 23 Oct 2026 is 08:15 UTC
  const slot = {
    id: 'slot-1',
    laneId: 'lane-1',
    date: new Date('2026-10-23T00:00:00Z'),
    startTime: '14:00',
    endTime: '15:00',
    isAvailable: true,
    isBlocked: false,
    lane: { id: 'lane-1', name: 'Lane 1', hourlyRate: 40 },
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-23T08:20:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    db.timeSlot.findUnique.mockResolvedValue(slot);
  });
  afterEach(() => jest.useRealTimers());

  it('rejects booking a slot that started 5 minutes ago with 422', async () => {
    const res = await request(app).post('/api/bookings').set('Authorization', bearer(customer)).send({ slotId: slot.id });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe(SLOT_STARTED_MESSAGE);
  });

  it('rejects rescheduling onto a started slot with 422', async () => {
    db.booking.findFirst.mockResolvedValue({
      id: 'b1',
      userId: customer.id,
      status: 'CONFIRMED',
      items: [{ slotId: 'slot-old', slot: { ...slot, id: 'slot-old', startTime: '18:00' } }],
      payment: null,
    });
    const res = await request(app)
      .patch('/api/bookings/b1')
      .set('Authorization', bearer(customer))
      .send({ slotId: slot.id });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe(SLOT_STARTED_MESSAGE);
  });
});

describe('Scheduler endpoints', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });
  afterAll(() => {
    delete process.env.CRON_SECRET;
  });

  it.each([
    ['get', '/api/internal/jobs/run'],
    ['post', '/api/internal/jobs/run'],
    ['get', '/api/internal/jobs/status'],
  ] as const)('%s %s returns 401 without the secret', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
    expect((await request(app)[method](url).set('x-cron-secret', 'wrong')).status).toBe(401);
  });

  it('returns the last-run records with the secret', async () => {
    db.jobRun.findMany.mockResolvedValue([{ name: 'unpaid-hold-expiry', lastStatus: 'success', runCount: 3 }]);
    const res = await request(app).get('/api/internal/jobs/status').set('Authorization', 'Bearer test-cron-secret');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('unpaid-hold-expiry');
  });
});
