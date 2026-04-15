import { Request, Response, NextFunction } from "express";
import { LanesService } from "./lanes.service";
import { sendSuccess } from "../../utils/apiResponse";

const lanesService = new LanesService();

export const getAllLanes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.query;
    const lanes = await lanesService.getAllLanes(type as string | undefined);
    sendSuccess(res, lanes);
  } catch (error) { next(error); }
};

export const getLaneById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lane = await lanesService.getLaneById(req.params.id);
    sendSuccess(res, lane);
  } catch (error) { next(error); }
};

export const getSlotsForLane = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date } = req.query;
    const slots = await lanesService.getSlotsForLane(req.params.id, date as string);
    sendSuccess(res, slots);
  } catch (error) { next(error); }
};
