import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  getAllBookings,
  deleteBooking,
  updateBooking,
} from './bookings.controller';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { cancelBookingSchema, createBookingSchema } from './bookings.validation';
import { updateBookingStatus } from '../admin/admin.controller';

const router: ExpressRouter = Router();

router.use(authenticate);

router.post('/', validate(createBookingSchema), createBooking);
router.get('/', requireRole('ADMIN', 'STAFF'), getAllBookings);

router.get('/my', getMyBookings);
router.get('/:id', getBookingById);
router.patch('/:id', authenticate, updateBooking);
router.patch('/:id/status', requireRole('ADMIN', 'STAFF'), updateBookingStatus);
router.patch('/:id/cancel', validate(cancelBookingSchema), cancelBooking);
// Hard delete is an admin operation; customers cancel instead
router.delete('/:id', requireRole('ADMIN'), deleteBooking);

export default router;
