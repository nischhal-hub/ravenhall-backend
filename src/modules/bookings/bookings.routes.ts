import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  getAllBookings,
} from './bookings.controller';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createBookingSchema } from './bookings.validation';

const router: ExpressRouter = Router();

router.use(authenticate);

router.post('/', validate(createBookingSchema), createBooking);
router.get('/', getAllBookings);

router.get('/my', getMyBookings);
router.get('/:id', getBookingById);
router.patch('/:id/cancel', cancelBooking);

export default router;
