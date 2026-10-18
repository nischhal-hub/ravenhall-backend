import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  getAllLanes,
  getAvailability,
  getLaneById,
  getSlotsForLane,
} from "./lanes.controller";

const router: ExpressRouter = Router();

router.get("/", getAllLanes);
// Must be declared before "/:id" so "availability" is not treated as an id
router.get("/availability", getAvailability);
router.get("/:id", getLaneById);
router.get("/:id/slots", getSlotsForLane);

export default router;
