import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import laneRoutes from '../modules/lanes/lanes.routes';
import bookingRoutes from '../modules/bookings/bookings.routes';
import paymentRoutes from '../modules/payments/payments.routes';
import membershipRoutes from '../modules/memberships/memberships.routes';
import discountRoutes from '../modules/discounts/discounts.routes';
import notificationRoutes from '../modules/notifications/notifications.routes';
import adminRoutes from '../modules/admin/admin.routes';
import userRoutes from '../modules/user/user.routes'; // Import user routes

const router: ExpressRouter = Router();

router.use('/auth', authRoutes);
router.use('/lanes', laneRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/memberships', membershipRoutes);
router.use('/discount', discountRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/user', userRoutes); 

// API docs
router.get('/', (_req, res) => {
  res.json({
    name: 'Ravenhall Indoor Cricket Centre API',
    version: '1.0.0',
    docs: '/api/docs',
  });
});

export default router;
