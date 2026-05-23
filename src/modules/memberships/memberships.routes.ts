import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';

import {
  getMembershipPlans,
  getMyMembership,
  createMembershipPaymentIntent,
  confirmMembershipPayment,
} from './memberships.controller';

import { authenticate } from '../../middleware/auth.middleware';

const router: ExpressRouter = Router();

router.get('/', getMembershipPlans); // Get all plans (no auth needed)

router.get('/me', authenticate, getMyMembership); // Get user's membership
router.post('/payment/intent', authenticate, createMembershipPaymentIntent);
router.post('/payment/confirm', authenticate, confirmMembershipPayment);

export default router;
