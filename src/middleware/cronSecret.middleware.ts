import { createHash, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Guards scheduler-triggered endpoints with a shared secret instead of user auth.
 * Accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or an
 * `x-cron-secret` header. With CRON_SECRET unset, every request is rejected.
 */
export const requireCronSecret = (req: Request, _res: Response, next: NextFunction) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  const provided =
    (typeof req.headers["x-cron-secret"] === "string" && req.headers["x-cron-secret"]) ||
    (auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined);

  // Compare fixed-length digests so the check takes the same time for any input
  if (!secret || !provided || !timingSafeEqual(digest(provided), digest(secret))) {
    return next(new AppError("Unauthorized", 401));
  }
  next();
};
