// Rules for the unpaid hold an online booking places on its slots.
// No imports, so payments and bookings can both use it without a cycle.

/** Recorded as the cancellation reason when the system releases an unpaid hold */
export const EXPIRED_HOLD_REASON = 'expired: payment not completed';

/** How long an unpaid online booking holds its slots (UNPAID_HOLD_MINUTES, default 15) */
export function unpaidHoldMinutes() {
  const value = Number(process.env.UNPAID_HOLD_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

/**
 * When the hold on an unpaid online booking runs out, or null when the
 * booking isn't on a hold (paid, cancelled, or a POS "pay at counter" booking).
 */
export function holdExpiresAt(booking: {
  status: string;
  source?: string | null;
  createdAt: Date;
}): Date | null {
  if (booking.status !== 'PENDING' || (booking.source ?? 'ONLINE') !== 'ONLINE') return null;
  return new Date(booking.createdAt.getTime() + unpaidHoldMinutes() * 60_000);
}
