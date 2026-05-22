import { Request, Response, NextFunction } from 'express';
import { PaymentsService } from './payments.service';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import { stripe } from '../../config/stripe';
import { logger } from '../../config/logger';

const paymentsService = new PaymentsService();

export const createPaymentIntent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log('Creating payment intent for bookingId:', req.body.bookingId);
    const result = await paymentsService.createPaymentIntent(
      req.user!.id,
      req.body.bookingId,
    );
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const confirmPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await paymentsService.confirmPayment(req.body.bookingId);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

// Stripe webhook handler — registered with raw body parser in app.ts
export const stripeWebhookHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const sig = req.headers['stripe-signature'] as string;
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    logger.error('Webhook signature verification failed:', err);
    return res.status(400).send('Webhook Error');
  }

  try {
    await paymentsService.handleWebhookEvent(event);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};
