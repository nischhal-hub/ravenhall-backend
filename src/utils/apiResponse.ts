import { Response } from "express";

export const sendSuccess = (
  res: Response,
  data: unknown,
  message = "Success",
  statusCode = 200
) => {
  res.status(statusCode).json({ status: "success", message, data });
};

export const sendCreated = (res: Response, data: unknown, message = "Created") => {
  sendSuccess(res, data, message, 201);
};
