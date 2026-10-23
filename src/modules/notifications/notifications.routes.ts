import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router: ExpressRouter = Router();

router.get("/my", authenticate, getMyNotifications);
router.patch("/read-all", authenticate, markAllNotificationsRead);
router.patch("/:id/read", authenticate, markNotificationRead);

export default router;
