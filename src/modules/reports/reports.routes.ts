import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  getRevenueReport,
  getRevenueSummary,
  getRevenueTrends,
} from './reports.controller';
import {
  revenueReportQuerySchema,
  revenueSummaryQuerySchema,
  revenueTrendsQuerySchema,
} from './reports.validation';

const router: ExpressRouter = Router();

// Financial reports are restricted to administrators
router.use(authenticate, requireRole('ADMIN'));

router.get('/', validate(revenueReportQuerySchema), getRevenueReport);
router.get('/summary', validate(revenueSummaryQuerySchema), getRevenueSummary);
router.get('/trends', validate(revenueTrendsQuerySchema), getRevenueTrends);

export default router;
