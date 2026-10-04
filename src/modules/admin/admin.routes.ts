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
  getAllUsers,
  updateUserRole,
  createDiscountCode,
  getAllDiscountCodes,
  updateDiscountCode,
  getDashboardData,
  deleteDiscountCode,
  getSlots,
} from './admin.controller';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { uploadLaneImage } from '../../middleware/upload.middleware';
import expenseRouter, { expenseCategoryRouter } from '../expenses/expenses.routes';
import reportsRouter from '../reports/reports.routes';

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
router.post('/lanes', requireRole('ADMIN'), uploadLaneImage, createLane);
router.patch(
  '/lanes/:id',
  requireRole('ADMIN', 'STAFF'),
  uploadLaneImage,
  updateLane,
);
router.delete('/lanes/:id', requireRole('ADMIN'), deleteLane);

// ── Slots ─────────────────────────────────────────────────────────────────
router.get('/slots', getSlots);
router.post('/slots/block', requireRole('ADMIN', 'STAFF'), blockSlots);
router.post('/slots/unblock', requireRole('ADMIN', 'STAFF'), unblockSlots);

// ── Expenses & Categories ─────────────────────────────────────────────────
router.use('/expenses', expenseRouter);
router.use('/expense-categories', expenseCategoryRouter);

// ── Reports ───────────────────────────────────────────────────────────────
router.use('/reports', reportsRouter);
router.use('/reports/revenue', reportsRouter);

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
