import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { createPaymentIntent, confirmPayment } from "./payments.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { paymentRateLimiter } from "../../middleware/rateLimiter.middleware";
import { validate } from "../../middleware/validate.middleware";
import { createPaymentIntentSchema } from "./payments.validation";

const router: ExpressRouter = Router();

router.post(
  "/intent",
  authenticate,
  paymentRateLimiter,
  validate(createPaymentIntentSchema),
  createPaymentIntent,
);

// Webhook is registered directly in app.ts (needs raw body)

export default router;
