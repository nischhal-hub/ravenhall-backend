import type { Request } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";

export const globalRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const authRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: { error: "Too many auth attempts, please try again in an hour." },
});

export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Too many payment requests." },
});

// ── Resend verification code ──────────────────────────────────────────────
// Per email AND per IP: at most 1 request per 60 s and 5 per hour. Each limiter
// keeps its own MemoryStore (per instance; fine for one API server) so tests
// can reset them. 429s carry Retry-After and a plain-language message.
const resendStores: MemoryStore[] = [];

const resendEmailKey = (req: Request) =>
  `email:${String(req.body?.email ?? "").trim().toLowerCase()}`;

function resendLimiter(windowMs: number, max: number, byEmail: boolean) {
  const store = new MemoryStore();
  resendStores.push(store);
  return rateLimit({
    windowMs,
    max,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    ...(byEmail && { keyGenerator: resendEmailKey }),
    handler: (req, res) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfter = Math.max(
        1,
        Math.ceil(((resetTime?.getTime() ?? Date.now() + windowMs) - Date.now()) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        status: "error",
        message: `Please wait ${retryAfter} seconds before asking for another code.`,
        retryAfter,
      });
    },
  });
}

export const resendVerificationLimiters = [
  resendLimiter(60 * 1000, 1, true),
  resendLimiter(60 * 60 * 1000, 5, true),
  resendLimiter(60 * 1000, 1, false),
  resendLimiter(60 * 60 * 1000, 5, false),
];

/** Test helper: clear every resend counter */
export async function resetResendVerificationLimits() {
  await Promise.all(resendStores.map((store) => store.resetAll()));
}
