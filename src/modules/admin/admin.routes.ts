import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
  getAllBookings,
  updateBookingStatus,
  createLane,
  updateLane,
  deleteLane,
  blockSlots,
  unblockSlots,
  getRevenueReport,
  getAllUsers,
  updateUserRole,
  createDiscountCode,
  getAllDiscountCodes,
  updateDiscountCode,
  getDashboardData,
  deleteDiscountCode,
} from './admin.controller';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router: ExpressRouter = Router();

// All admin routes require authentication + ADMIN or STAFF role
router.use(authenticate);

// ── Bookings ──────────────────────────────────────────────────────────────
router.get('/bookings', requireRole('ADMIN', 'STAFF'), getAllBookings);
router.patch(
  '/bookings/:id/status',
  requireRole('ADMIN', 'STAFF'),
  updateBookingStatus,
);

// ── Lanes ─────────────────────────────────────────────────────────────────
router.post('/lanes', requireRole('ADMIN'), createLane);
router.put('/lanes/:id', requireRole('ADMIN', 'STAFF'), updateLane);
router.delete('/lanes/:id', requireRole('ADMIN'), deleteLane);

// ── Slots ─────────────────────────────────────────────────────────────────
router.post('/slots/block', requireRole('ADMIN', 'STAFF'), blockSlots);
router.post('/slots/unblock', requireRole('ADMIN', 'STAFF'), unblockSlots);

// ── Reports ───────────────────────────────────────────────────────────────
router.get('/reports/revenue', requireRole('ADMIN'), getRevenueReport);

// ── Users ─────────────────────────────────────────────────────────────────
router.get('/users', requireRole('ADMIN'), getAllUsers);
router.patch('/users/:id/role', requireRole('ADMIN'), updateUserRole);

// ── Discount codes ────────────────────────────────────────────────────────
router.post('/discounts', requireRole('ADMIN'), createDiscountCode);
router.get('/discounts', requireRole('ADMIN', 'STAFF'), getAllDiscountCodes);
router.patch('/discounts/:id', requireRole('ADMIN'), updateDiscountCode);
router.delete('/discounts/:id', requireRole('ADMIN'), deleteDiscountCode);

router.get('/dashboard', requireRole('ADMIN'), getDashboardData);

export default router;
