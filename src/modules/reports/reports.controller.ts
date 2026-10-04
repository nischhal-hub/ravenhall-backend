import { NextFunction, Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import { ReportsService } from './reports.service';
import { GroupByInterval } from './reports.types';

const reportsService = new ReportsService();

/**
 * GET /admin/reports/revenue
 * Comprehensive financial report including revenue, expenses, net profit, and timeline
 */
export const getRevenueReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { from, to, groupBy = 'day' } = req.query;
    const report = await reportsService.getRevenueReport({
      from: from as string | undefined,
      to: to as string | undefined,
      groupBy: groupBy as GroupByInterval,
    });
    sendSuccess(res, report);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/reports/revenue/summary
 * Executive financial KPI summary
 */
export const getRevenueSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { from, to } = req.query;
    const summary = await reportsService.getRevenueSummary(
      from as string | undefined,
      to as string | undefined
    );
    sendSuccess(res, summary);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/reports/revenue/trends
 * Revenue vs Expenses vs Net Profit time-series trends with growth rates
 */
export const getRevenueTrends = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { from, to, interval = 'month' } = req.query;
    const trends = await reportsService.getRevenueTrends({
      from: from as string | undefined,
      to: to as string | undefined,
      interval: interval as GroupByInterval,
    });
    sendSuccess(res, trends);
  } catch (error) {
    next(error);
  }
};
