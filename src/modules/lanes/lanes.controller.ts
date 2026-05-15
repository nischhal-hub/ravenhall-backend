import { Request, Response, NextFunction } from 'express';
import { LanesService } from './lanes.service';
import { sendSuccess } from '../../utils/apiResponse';

const lanesService = new LanesService();

export const getAllLanes = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { page = 1, limit = 20, search = '', type } = req.query;

    const result = await lanesService.getAllLanes({
      page: Number(page),
      limit: Number(limit),
      search: search as string,
      type: type as string | undefined,
    });

    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const getLaneById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const lane = await lanesService.getLaneById(req.params.id);
    sendSuccess(res, lane);
  } catch (error) {
    next(error);
  }
};

export const getSlotsForLane = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { date } = req.query;
    const slots = await lanesService.getSlotsForLane(
      req.params.id,
      date as string,
    );
    sendSuccess(res, slots);
  } catch (error) {
    next(error);
  }
};
