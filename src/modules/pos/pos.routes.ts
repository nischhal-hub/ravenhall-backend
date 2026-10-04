import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  searchCustomers,
  createWalkInCustomer,
  getCustomerById,
  getLanesAndSlots,
  calculatePrice,
  createPosBooking,
  getPosBookings,
  getPosBookingById,
  getPosReceipt,
  completePosPayment,
} from './pos.controller';
import {
  createPosCustomerSchema,
  calculatePosPriceSchema,
  createPosBookingSchema,
  completePosPaymentSchema,
  getPosSlotsSchema,
} from './pos.validation';

const router: ExpressRouter = Router();

// All POS routes require authentication and STAFF or ADMIN role
router.use(authenticate, requireRole('ADMIN', 'STAFF'));

// ── Customer Lookup & Registration ─────────────────────────────────────────
router.get('/customers', searchCustomers);
router.post('/customers', validate(createPosCustomerSchema), createWalkInCustomer);
router.get('/customers/:id', getCustomerById);

// ── Lane & Slot Availability Grid ──────────────────────────────────────────
router.get('/lanes-and-slots', validate(getPosSlotsSchema), getLanesAndSlots);

// ── Pricing Calculation ───────────────────────────────────────────────────
router.post('/calculate-price', validate(calculatePosPriceSchema), calculatePrice);

// ── Bookings & Checkout ───────────────────────────────────────────────────
router.post('/bookings', validate(createPosBookingSchema), createPosBooking);
router.get('/bookings', getPosBookings);
router.get('/bookings/:id', getPosBookingById);
router.get('/bookings/:id/receipt', getPosReceipt);
router.post('/bookings/:id/pay', validate(completePosPaymentSchema), completePosPayment);

export default router;
