import { Response, NextFunction } from 'express';
import { BookingsService } from './bookings.service';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendSuccess, sendCreated } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';

const bookingsService = new BookingsService();

export const createBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const booking = await bookingsService.createBooking(req.user!.id, req.body);
    sendCreated(res, booking, 'Booking created successfully');
  } catch (error) {
    next(error);
  }
};
export const getAllBookings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const result = await bookingsService.getAllBookings(pagination);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const getMyBookings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const result = await bookingsService.getMyBookings(
      req.user!.id,
      pagination,
    );
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

export const getBookingById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    console;
    const booking = await bookingsService.getBookingById(
      req.params.id,
      req.user!.id,
    );
    sendSuccess(res, booking);
  } catch (error) {
    next(error);
  }
};

export const cancelBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const booking = await bookingsService.cancelBooking(
      req.params.id,
      req.user!.id,
    );
    sendSuccess(res, booking, 'Booking cancelled successfully');
  } catch (error) {
    next(error);
  }
};

export const deleteBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await bookingsService.deleteBooking(req.params.id);
    sendSuccess(res, result, 'Booking deleted successfully');
  } catch (error) {
    next(error);
  }
};
