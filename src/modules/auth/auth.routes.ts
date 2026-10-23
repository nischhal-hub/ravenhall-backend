import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import {
  register,
  login,
  logout,
  refreshToken,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getProfile,
} from './auth.controller';
import { authenticate } from '../../middleware/auth.middleware';
import {
  authRateLimiter,
  resendVerificationLimiters,
} from '../../middleware/rateLimiter.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resendVerificationSchema,
} from './auth.validation';

const router: ExpressRouter = Router();

router.post('/register', authRateLimiter, validate(registerSchema), register);
router.post('/login', authRateLimiter, validate(loginSchema), login);
router.post('/logout', authenticate, logout);
router.post('/refresh', refreshToken);
router.get('/me', authenticate, getMe);
router.get('/profile', authenticate, getProfile);
router.get('/verify-email/:token', verifyEmail);
// 1 per 60 s and 5 per hour, per email and per IP; same response for any email
router.post(
  '/resend-verification',
  validate(resendVerificationSchema),
  ...resendVerificationLimiters,
  resendVerification,
);
router.post(
  '/forgot-password',
  authRateLimiter,
  validate(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  '/reset-password',
  authRateLimiter,
  validate(resetPasswordSchema),
  resetPassword,
);

export default router;
