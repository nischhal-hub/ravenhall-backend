import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { validateDiscountCode } from "./discounts.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router: ExpressRouter = Router();

router.post("/validate", authenticate, validateDiscountCode);

export default router;
