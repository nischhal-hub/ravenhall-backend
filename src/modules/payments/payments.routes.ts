import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
  createPaymentIntent,
  confirmPayment,
  startCheckout,
  confirmCheckout,
} from './payments.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { paymentRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  confirmCheckoutSchema,
  createPaymentIntentSchema,
  startCheckoutSchema,
} from './payments.validation';

const router: ExpressRouter = Router();

// New online booking: pay first, the booking is created once the payment succeeds
router.post(
  '/checkout',
  authenticate,
  paymentRateLimiter,
  validate(startCheckoutSchema),
  startCheckout,
);

// Called when the customer returns from Stripe after paying for a new booking
router.post(
  '/checkout/confirm',
  authenticate,
  paymentRateLimiter,
  validate(confirmCheckoutSchema),
  confirmCheckout,
);

// Pay for an existing PENDING booking (e.g. a POS "pay at the counter" one)
router.post(
  '/intent',
  authenticate,
  paymentRateLimiter,
  validate(createPaymentIntentSchema),
  createPaymentIntent,
);

// Called when the customer returns from Stripe; checks the real payment status
router.post(
  '/confirm',
  authenticate,
  paymentRateLimiter,
  validate(createPaymentIntentSchema),
  confirmPayment,
);

// Webhook is registered directly in app.ts (needs raw body)

export default router;
