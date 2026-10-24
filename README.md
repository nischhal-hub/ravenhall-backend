# Ravenhall Indoor Cricket Centre — Backend API

Node.js + Express.js + TypeScript + Prisma + PostgreSQL

## Quick Start

```bash
# 1. Install dependencies (pnpm only; the version is pinned in package.json "packageManager")
corepack enable
pnpm install --frozen-lockfile

# 2. Copy environment file and fill in values
cp .env.example .env

# 3. Start database (Docker)
docker-compose up -d postgres

# 4. Run migrations and seed
pnpm exec prisma migrate dev
pnpm run prisma:seed

# 5. Start dev server
pnpm run dev
# → http://localhost:4000
```

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /api/auth/register | Register customer | No |
| POST | /api/auth/login | Login | No |
| POST | /api/auth/logout | Logout | Yes |
| POST | /api/auth/refresh | Refresh access token | No |
| GET | /api/auth/me | Get current user | Yes |
| POST | /api/auth/resend-verification | Send a new email-verification code (body: `{ email }`; same answer whether or not the account exists; 1/min and 5/hour per email and per IP, 429 + `Retry-After`) | No |
| POST | /api/auth/forgot-password | Send reset email | No |
| POST | /api/auth/reset-password | Reset password | No |
| GET | /api/lanes | List all active lanes | No |
| GET | /api/lanes/:id | Get lane by ID | No |
| GET | /api/lanes/:id/slots?date= | Get slots for lane | No |
| POST | /api/bookings | Create booking | Customer |
| GET | /api/bookings/my | My bookings | Customer |
| GET | /api/bookings/:id | Get booking (own only; any for staff). Unpaid online bookings include `holdExpiresAt` | Customer |
| PATCH | /api/bookings/:id/cancel | Cancel own booking (body: `{ reason? }`) | Customer |
| GET | /api/notifications/my | In-app notifications + `unreadCount` | Yes |
| PATCH | /api/notifications/:id/read | Mark one as read | Yes |
| PATCH | /api/notifications/read-all | Mark all as read | Yes |
| POST | /api/payments/intent | Create Stripe intent | Customer |
| POST | /api/payments/confirm | Check a booking's payment with Stripe after checkout (body: `{ bookingId }`) | Customer |
| POST | /api/payments/webhook | Stripe webhook | Stripe |
| GET | /api/memberships | List plans | No |
| GET | /api/memberships/my | My membership | Customer |
| POST | /api/memberships/subscribe | Subscribe | Customer |
| POST | /api/discount/validate | Validate code | Customer |
| GET | /api/admin/bookings | All bookings | Admin/Staff |
| PATCH | /api/admin/bookings/:id/status | Update status (guarded transitions; `CANCELLED` uses the cancel flow) | Admin/Staff |
| PATCH | /api/admin/bookings/:id/cancel | Cancel any booking + notify customer (body: `{ reason? }`) | Admin/Staff |
| POST | /api/admin/lanes | Create lane | Admin |
| PUT | /api/admin/lanes/:id | Update lane | Admin/Staff |
| DELETE | /api/admin/lanes/:id | Delete lane | Admin |
| POST | /api/admin/slots/block | Block slots | Admin/Staff |
| POST | /api/admin/slots/unblock | Unblock slots | Admin/Staff |
| GET | /api/admin/reports/revenue | Revenue report | Admin |
| GET | /api/admin/users | All users | Admin |
| GET | /api/admin/users/:id | One user: profile, membership, booking count, 10 most recent bookings (no secrets) | Admin/Staff |
| PATCH | /api/admin/users/:id/role | Update role | Admin |
| POST | /api/admin/discounts | Create code | Admin |
| GET | /api/admin/discounts | List codes | Admin/Staff |
| PATCH | /api/admin/discounts/:id | Update code | Admin |
| GET/POST | /api/internal/jobs/run | Run all scheduled jobs: booking reminders, then unpaid-hold expiry | `CRON_SECRET` |
| GET | /api/internal/jobs/status | Last run of each job (started/finished, status, result, error, count) | `CRON_SECRET` |
| GET/POST | /api/internal/jobs/booking-reminders | Reminders only (kept for existing schedulers) | `CRON_SECRET` |

## Environment Variables

See `.env.example`. Email-related variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` / `SMTP_PORT` | No | SMTP server (defaults `smtp.gmail.com` / `465`; port 465 uses TLS) |
| `SMTP_USER` / `SMTP_PASS` | Yes (to send) | SMTP credentials (for Gmail use an App Password) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Yes | Sender address and display name |
| `EMAIL_ENABLED` | No | Set to `false` to log emails instead of sending (local dev / CI). Default: enabled |
| `CLIENT_URL` | Recommended | Frontend URL; used for CORS and for links in emails |

Transactional emails (welcome on email verification, booking confirmed, booking cancelled) are sent
fire-and-forget after the DB commit and deduplicated per event via `Notification.dedupeKey`,
so a mail failure never breaks a request and webhook retries never send twice.

### Business timezone

All slot times are wall-clock times in **one** business timezone, `BUSINESS_TIMEZONE` (IANA name, default
`Asia/Kathmandu`). Every conversion goes through `src/utils/businessTime.ts`; nothing depends on the server's
`TZ`, and there are no fixed offsets. "Today" for slot generation and availability, report day/week/month
buckets and date-range filters, booking-reference years and email dates all use this zone. The frontend
uses the same zone (`NEXT_PUBLIC_BUSINESS_TIMEZONE`), so set both to the same value.

### Scheduled jobs

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | To schedule jobs | Secret for `/api/internal/jobs/*`, sent as `Authorization: Bearer <secret>` or `x-cron-secret`. Requests without it get 401; unset disables the endpoints |
| `JOBS_CRON_ENABLED` | No | `true` runs all jobs in-process every 5 minutes (long-running servers only). Default off. `REMINDER_CRON_ENABLED=true` is still accepted |
| `REMINDER_LEAD_MINUTES` | No | Minutes before a session to send the reminder. Default `60` |
| `UNPAID_HOLD_MINUTES` | No | How long an unpaid online booking holds its slot. Default `15` |
| `POS_WALKIN_GRACE_MINUTES` | No | How long after a slot starts the POS can still sell it to a walk-in. Default `60` |

**Scheduling.** Call `/api/internal/jobs/run` every 5 minutes with one of:
- **GitHub Actions** (works with any host): `.github/workflows/scheduled-jobs.yml` runs every 5 minutes
  (GitHub may start it a few minutes late). Set repository secrets `JOBS_URL`
  (e.g. `https://api.example.com/api/internal/jobs/run`) and `CRON_SECRET`.
- **Long-running server (Docker/VM)**: `JOBS_CRON_ENABLED=true`.
- **Vercel Pro**: add `{ "crons": [{ "path": "/api/internal/jobs/run", "schedule": "*/5 * * * *" }] }` to
  `vercel.json` and set `CRON_SECRET`; Vercel sends `Authorization: Bearer $CRON_SECRET` itself. Not committed,
  because Hobby plans reject crons that run more than once a day and fail the deploy.

Running more than one of these, overlapping runs and multiple instances are all safe. Each run updates a
`JobRun` row per job; read it with `GET /api/internal/jobs/status`.

Manual trigger: `curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:4000/api/internal/jobs/run`

#### Booking reminders

Customers get an in-app notification and an email `REMINDER_LEAD_MINUTES` (default 60) before a
**confirmed** booking starts, e.g. at 1:00 PM for a 2:00 PM session.

- Each run picks up confirmed bookings that haven't started and start within the lead time (+3 min tolerance),
  so a late run still catches up, but a booking that has already started is never reminded.
- Status and slot are re-checked right before sending: a booking cancelled or rescheduled in the meantime gets nothing for its old state.
- Deduplicated by `booking-reminder:<bookingId>:<startTimeISO>` (in-app) and `email:booking-reminder:…` (email log),
  so a rescheduled booking gets one reminder for its new time only.
- Skipped when the booking was made or confirmed less than the lead time before it starts (the confirmation was just sent),
  and for POS walk-in guests. A missing email address still gets the in-app notification.
- A failed email is recorded as `FAILED` and retried by later runs for up to 15 minutes, never after the session starts.

#### Unpaid-hold expiry

An online booking holds its slot while the customer pays. If it is still `PENDING` `UNPAID_HOLD_MINUTES`
(default 15) after it was created, the job releases it:

- Stripe is checked first: if the payment actually succeeded the booking is confirmed instead; if Stripe is
  still processing, the next run tries again. Otherwise the PaymentIntent is cancelled (idempotency key
  `expire-booking-<id>`).
- The booking is cancelled through the normal cancel path (`CANCELLED`, reason `expired: payment not completed`,
  slot freed) with a conditional update, so concurrent runs release it once.
- The customer is notified once: in-app `booking-expired:<id>` plus an email.
- POS "pay at the counter" bookings are never expired.
- `GET /api/bookings/:id` returns `holdExpiresAt` so the app can show a countdown; starting payment after it
  has passed is refused with 409.
- If a payment still lands after expiry (webhook or confirm), the slot is re-claimed and the booking confirmed
  when it's still free and hasn't started; otherwise the payment is refunded once (`refund-booking-<id>`) and
  the customer is told by in-app notification and email.

### Booking rules

Bookings and reschedules onto a slot that has already started (in `BUSINESS_TIMEZONE`) are rejected with
422 `This time slot has already started. Please choose a later slot.` The POS allows walk-ins up to
`POS_WALKIN_GRACE_MINUTES` after the start.

## Default Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@ravenhallcricket.com.au | Admin@123 |
| Staff | staff@ravenhallcricket.com.au | Staff@123 |
| Customer | customer@test.com | Test@123 |

## Scripts

```bash
pnpm run dev            # Development server with hot reload
pnpm run build          # Compile TypeScript to dist/
pnpm run start          # Run compiled production build
pnpm run test           # Run tests (needs the test database: see Tests below)
pnpm run test:all       # Start the test database, then run all tests
pnpm run test:db:up     # Start the throwaway test Postgres (Docker, port 55433)
pnpm run test:db:down   # Stop it (its data is in memory and is discarded)
pnpm run test:coverage  # Tests with coverage report
pnpm run prisma:migrate # Run database migrations
pnpm run prisma:seed    # Seed demo data
pnpm run prisma:studio  # Open Prisma Studio GUI
```

## Tests

Tests never use `.env`. They load `.env.test` only, and the setup **refuses to run** unless
`DATABASE_URL` points at `localhost` / `127.0.0.1` and the database name contains `test`, so the
real (Neon) database can't be touched even if its URL is exported in your shell.

```bash
cp .env.test.example .env.test   # once
pnpm test:all                    # starts the test Postgres (Docker) and runs every suite
```

- **Database suites** (`auth`, `lanes`, `pos`, `expenses-reports`) use a throwaway Postgres from
  `docker-compose.test.yml` (in-memory, port 55433). The Jest global setup runs
  `prisma migrate deploy` once per run; each of these suites calls `useTestDatabase()`, which
  empties every table before the suite starts, so suites are independent of order and of earlier runs.
- **Mocked suites** (bookings, payments, reminders, expiry, endpoints, business time) mock Prisma,
  Stripe and SMTP and need no database. If the database isn't running they still pass; only the
  database suites fail, with a "start it with `pnpm test:db:up`" message.
- `.env.test` contains dummy Stripe/Cloudinary values and `EMAIL_ENABLED=false`: nothing is sent anywhere.
- CI (`.github/workflows/test.yml`) runs the same steps against a Postgres service container.
