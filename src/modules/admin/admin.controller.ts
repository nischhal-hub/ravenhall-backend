import { Request, Response, NextFunction } from 'express';
import { AdminService } from './admin.service';
import { sendSuccess, sendCreated } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';

const adminService = new AdminService();

export const getAllBookings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const filters = {
      status: req.query.status as string,
      laneId: req.query.laneId as string,
      dateFrom: req.query.dateFrom as string,
      dateTo: req.query.dateTo as string,
      search: req.query.search as string,
    };
    const result = await adminService.getAllBookings(pagination, filters);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const updateBookingStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const booking = await adminService.updateBookingStatus(
      req.params.id,
      req.body.status,
    );
    sendSuccess(res, booking);
  } catch (error) {
    next(error);
  }
};

export const createLane = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const lane = await adminService.createLane(req.body);
    sendCreated(res, lane, 'Lane created successfully');
  } catch (error) {
    next(error);
  }
};

export const updateLane = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const lane = await adminService.updateLane(req.params.id, req.body);
    sendSuccess(res, lane);
  } catch (error) {
    next(error);
  }
};

export const deleteLane = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await adminService.deleteLane(req.params.id);
    sendSuccess(res, null, 'Lane deleted successfully');
  } catch (error) {
    next(error);
  }
};
export const getSlots = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const {
      date,
      laneId,
      isBlocked,
      page = '1',
      limit = '20',
      search,
    } = req.query;

    const result = await adminService.getSlots({
      date: date as string,
      laneId: laneId as string,
      search: search as string,
      page: Number(page),
      limit: Number(limit),
      isBlocked:
        isBlocked === 'true' ? true : isBlocked === 'false' ? false : undefined,
    });

    sendSuccess(res, result, 'Slots fetched successfully');
  } catch (error) {
    next(error);
  }
};

export const blockSlots = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await adminService.blockSlots(req.body.slotIds);
    sendSuccess(res, null, 'Slots blocked successfully');
  } catch (error) {
    next(error);
  }
};

export const unblockSlots = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    await adminService.unblockSlots(req.body.slotIds);
    sendSuccess(res, null, 'Slots unblocked successfully');
  } catch (error) {
    next(error);
  }
};

export const getRevenueReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { from, to, groupBy } = req.query;
    const report = await adminService.getRevenueReport(
      from as string,
      to as string,
      (groupBy as string) || 'day',
    );
    sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const result = await adminService.getAllUsers(
      pagination,
      req.query.search as string,
    );
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await adminService.updateUserRole(
      req.params.id,
      req.body.role,
    );
    sendSuccess(res, user);
  } catch (error) {
    next(error);
  }
};

export const createDiscountCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const code = await adminService.createDiscountCode(req.body);
    sendCreated(res, code, 'Discount code created');
  } catch (error) {
    next(error);
  }
};

export const getAllDiscountCodes = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const codes = await adminService.getAllDiscountCodes();
    sendSuccess(res, codes);
  } catch (error) {
    next(error);
  }
};

export const updateDiscountCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const code = await adminService.updateDiscountCode(req.params.id, req.body);
    sendSuccess(res, code);
  } catch (error) {
    next(error);
  }
};
export const deleteDiscountCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await adminService.deleteDiscountCode(req.params.id);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const getDashboardData = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await adminService.getDashboardData(req, res);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
};
