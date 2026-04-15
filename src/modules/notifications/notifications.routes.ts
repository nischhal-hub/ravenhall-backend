import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { getMyNotifications } from "./notifications.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router: ExpressRouter = Router();

router.get("/my", authenticate, getMyNotifications);

export default router;
