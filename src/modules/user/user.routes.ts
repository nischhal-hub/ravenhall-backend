// routes/user.routes.ts
import { Router } from 'express';
import {
  changePassword,
  getMyProfile,
  getUserDashboard,
  updateMyProfile,
} from './user.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router: Router = Router();

router.get('/dashboard', authenticate, getUserDashboard);
// routes/user.routes.ts
router.get('/profile', authenticate, getMyProfile);
router.patch('/profile', authenticate, updateMyProfile);
router.post('/change-password', authenticate, changePassword);

export default router;
