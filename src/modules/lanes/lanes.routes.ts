import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { getAllLanes, getLaneById, getSlotsForLane } from "./lanes.controller";

const router: ExpressRouter = Router();

router.get("/", getAllLanes);
router.get("/:id", getLaneById);
router.get("/:id/slots", getSlotsForLane);

export default router;
