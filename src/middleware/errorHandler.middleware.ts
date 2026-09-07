import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";
import { logger } from "../config/logger";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`, err);

  // Known operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: "error",
      message: err.message,
    });
  }

  // Multer upload errors
  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image must be smaller than 5MB"
        : err.message;
    return res.status(400).json({
      status: "error",
      message,
    });
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(422).json({
      status: "error",
      message: "Validation failed",
      errors: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // Prisma unique constraint violation
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        status: "error",
        message: "A record with this value already exists",
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        status: "error",
        message: "Record not found",
      });
    }
  }

  // Unexpected errors — do not expose internals
  return res.status(500).json({
    status: "error",
    message: "Something went wrong. Please try again.",
  });
};
