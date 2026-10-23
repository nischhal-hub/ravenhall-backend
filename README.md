# Ravenhall Indoor Cricket Centre — Backend API

Node.js + Express.js + TypeScript + Prisma + PostgreSQL

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and fill in values
cp .env.example .env

# 3. Start database (Docker)
docker-compose up -d postgres

# 4. Run migrations and seed
npx prisma migrate dev
npm run prisma:seed

# 5. Start dev server
npm run dev
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
| POST | /api/auth/forgot-password | Send reset email | No |
| POST | /api/auth/reset-password | Reset password | No |
| GET | /api/lanes | List all active lanes | No |
| GET | /api/lanes/:id | Get lane by ID | No |
| GET | /api/lanes/:id/slots?date= | Get slots for lane | No |
| POST | /api/bookings | Create booking | Customer |
| GET | /api/bookings/my | My bookings | Customer |
| GET | /api/bookings/:id | Get booking (own only; any for staff) | Customer |
| PATCH | /api/bookings/:id/cancel | Cancel own booking (body: `{ reason? }`) | Customer |
| GET | /api/notifications/my | In-app notifications + `unreadCount` | Yes |
| PATCH | /api/notifications/:id/read | Mark one as read | Yes |
| PATCH | /api/notifications/read-all | Mark all as read | Yes |
| POST | /api/payments/intent | Create Stripe intent | Customer |
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
| PATCH | /api/admin/users/:id/role | Update role | Admin |
| POST | /api/admin/discounts | Create code | Admin |
| GET | /api/admin/discounts | List codes | Admin/Staff |
| PATCH | /api/admin/discounts/:id | Update code | Admin |

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

## Default Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@ravenhallcricket.com.au | Admin@123 |
| Staff | staff@ravenhallcricket.com.au | Staff@123 |
| Customer | customer@test.com | Test@123 |

## Scripts

```bash
npm run dev            # Development server with hot reload
npm run build          # Compile TypeScript to dist/
npm run start          # Run compiled production build
npm run test           # Run tests
npm run test:coverage  # Tests with coverage report
npm run prisma:migrate # Run database migrations
npm run prisma:seed    # Seed demo data
npm run prisma:studio  # Open Prisma Studio GUI
```
