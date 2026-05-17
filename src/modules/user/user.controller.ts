// controllers/user.controller.ts
import { Request, Response, NextFunction } from 'express';
import { UserService } from './user.service';
import { sendSuccess } from '../../utils/apiResponse';
import { AuthRequest } from '@/middleware/auth.middleware';

const userService = new UserService();

export const getUserDashboard = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id;
    const data = await userService.getDashboard(userId);

    sendSuccess(res, data, 'Dashboard fetched successfully');
  } catch (error) {
    next(error);
  }
};

// controllers/user.controller.ts

export const getMyProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await userService.getProfile(req.user!.id);
    sendSuccess(res, user);
  } catch (error) {
    next(error);
  }
};

export const updateMyProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await userService.updateProfile(req.user!.id, req.body);
    sendSuccess(res, user, 'Profile updated successfully');
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = await userService.changePassword(
      req.user!.id,
      oldPassword,
      newPassword,
    );
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
};
