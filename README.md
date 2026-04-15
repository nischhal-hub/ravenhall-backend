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
| GET | /api/bookings/:id | Get booking | Customer |
| PATCH | /api/bookings/:id/cancel | Cancel booking | Customer |
| POST | /api/payments/intent | Create Stripe intent | Customer |
| POST | /api/payments/webhook | Stripe webhook | Stripe |
| GET | /api/memberships | List plans | No |
| GET | /api/memberships/my | My membership | Customer |
| POST | /api/memberships/subscribe | Subscribe | Customer |
| POST | /api/discount/validate | Validate code | Customer |
| GET | /api/admin/bookings | All bookings | Admin/Staff |
| PATCH | /api/admin/bookings/:id/status | Update status | Admin/Staff |
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
