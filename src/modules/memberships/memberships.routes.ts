import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  getMembershipPlans,
  subscribeMembership,
  getMyMembership,
} from "./memberships.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router: ExpressRouter = Router();

router.get("/", getMembershipPlans);
router.get("/my", authenticate, getMyMembership);
router.post("/subscribe", authenticate, subscribeMembership);

export default router;
