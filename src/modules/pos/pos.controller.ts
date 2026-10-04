import { Response, NextFunction } from 'express';
import { PosService } from './pos.service';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { PaymentMethod } from '@prisma/client';

const posService = new PosService();

/**
 * Search registered customers by name, email, or phone
 * GET /api/pos/customers?search=...
 */
export const searchCustomers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { search = '', limit = '10' } = req.query;
    const customers = await posService.searchCustomers(
      search as string,
      parseInt(limit as string, 10) || 10
    );
    sendSuccess(res, customers);
  } catch (error) {
    next(error);
  }
};

/**
 * Quick create walk-in customer at the counter
 * POST /api/pos/customers
 */
export const createWalkInCustomer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const customer = await posService.createWalkInCustomer(req.body);
    sendCreated(res, customer, 'Customer registered successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Get customer details & membership
 * GET /api/pos/customers/:id
 */
export const getCustomerById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const customer = await posService.getCustomerById(req.params.id);
    sendSuccess(res, customer);
  } catch (error) {
    next(error);
  }
};

/**
 * Get lanes and their slot availability for a specific date (POS calendar/grid)
 * GET /api/pos/lanes-and-slots?date=YYYY-MM-DD&laneId=...
 */
export const getLanesAndSlots = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { date, laneId } = req.query;
    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date query parameter is required (YYYY-MM-DD)',
      });
    }

    const lanesWithSlots = await posService.getLanesAndSlots(
      date as string,
      laneId as string | undefined
    );
    sendSuccess(res, lanesWithSlots);
  } catch (error) {
    next(error);
  }
};

/**
 * Preview / Calculate pricing for selected slots before confirming booking
 * POST /api/pos/calculate-price
 */
export const calculatePrice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      slotIds,
      slotId,
      customerId,
      discountCode,
      customDiscountPct,
      customDiscountAmount,
    } = req.body;

    const normalizedSlotIds = slotIds && slotIds.length > 0 ? slotIds : slotId ? [slotId] : [];

    const breakdown = await posService.calculatePrice({
      slotIds: normalizedSlotIds,
      customerId,
      discountCode,
      customDiscountPct,
      customDiscountAmount,
    });

    sendSuccess(res, breakdown);
  } catch (error) {
    next(error);
  }
};

/**
 * Create walk-in ground booking from POS
 * POST /api/pos/bookings
 */
export const createPosBooking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const staffUserId = req.user!.id;
    const {
      customerId,
      customer,
      isGuest,
      slotIds,
      slotId,
      paymentMethod,
      paymentStatus,
      discountCode,
      customDiscountPct,
      customDiscountAmount,
      discountReason,
      notes,
    } = req.body;

    const normalizedSlotIds = slotIds && slotIds.length > 0 ? slotIds : slotId ? [slotId] : [];

    const booking = await posService.createPosBooking(staffUserId, {
      customerId,
      customer,
      isGuest,
      slotIds: normalizedSlotIds,
      paymentMethod,
      paymentStatus,
      discountCode,
      customDiscountPct,
      customDiscountAmount,
      discountReason,
      notes,
    });

    sendCreated(res, booking, 'POS Booking completed successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * List POS bookings with filters
 * GET /api/pos/bookings
 */
export const getPosBookings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const pagination = getPaginationParams(req.query);
    const {
      search = '',
      date,
      status,
      paymentMethod,
      bookedById,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const result = await posService.getPosBookings({
      ...pagination,
      search: search as string,
      date: date as string | undefined,
      status: status as string | undefined,
      paymentMethod: paymentMethod as PaymentMethod | undefined,
      bookedById: bookedById as string | undefined,
      sortBy: sortBy as string,
      order: order as 'asc' | 'desc',
    });

    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get POS booking by ID
 * GET /api/pos/bookings/:id
 */
export const getPosBookingById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const booking = await posService.getPosBookingById(req.params.id);
    sendSuccess(res, booking);
  } catch (error) {
    next(error);
  }
};

/**
 * Get thermal printable receipt data
 * GET /api/pos/bookings/:id/receipt
 */
export const getPosReceipt = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const receipt = await posService.getPosReceipt(req.params.id);
    sendSuccess(res, receipt);
  } catch (error) {
    next(error);
  }
};

/**
 * Complete payment for unpaid / pending walk-in booking
 * POST /api/pos/bookings/:id/pay
 */
export const completePosPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentMethod, amount, notes } = req.body;
    const booking = await posService.completePayment(req.params.id, {
      paymentMethod,
      amount,
      notes,
    });
    sendSuccess(res, booking, 'Payment recorded and booking confirmed');
  } catch (error) {
    next(error);
  }
};
