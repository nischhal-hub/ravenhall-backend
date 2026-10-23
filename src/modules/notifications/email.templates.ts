// Reusable transactional email templates. Every template returns
// { subject, html, text } so clients without HTML support still get a readable message.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface BookingEmailDetails {
  bookingRef: string;
  laneName?: string;
  date?: Date | string;
  startTime?: string;
  endTime?: string;
  finalAmount: number;
}

const BRAND_NAME = 'Ravenhall Indoor Cricket Centre';
const BRAND_COLOR = '#047857';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const clientUrl = (path: string) => {
  const base = process.env.CLIENT_URL?.replace(/\/$/, '');
  return base ? `${base}${path}` : undefined;
};

const formatDate = (date?: Date | string) =>
  date
    ? new Date(date).toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : undefined;

const formatMoney = (amount: number) => `$${amount.toFixed(2)} AUD`;

// Wraps body content in the shared branded layout
const layout = (title: string, bodyHtml: string, cta?: { label: string; url?: string }) => `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:${BRAND_COLOR};padding:20px 24px;color:#ffffff;font-size:18px;font-weight:bold;">${BRAND_NAME}</td></tr>
          <tr><td style="padding:24px;">
            <h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h2>
            ${bodyHtml}
            ${
              cta?.url
                ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(cta.url)}" style="background:${BRAND_COLOR};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">${escapeHtml(cta.label)}</a></p>`
                : ''
            }
          </td></tr>
          <tr><td style="padding:16px 24px;background:#fafafa;color:#71717a;font-size:12px;">
            You are receiving this email because you have an account with ${BRAND_NAME}.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const textLayout = (lines: (string | undefined | false)[]) =>
  [...lines.filter((l): l is string => typeof l === 'string'), '', `— ${BRAND_NAME}`].join('\n');

const bookingRows = (b: BookingEmailDetails) => {
  const when = formatDate(b.date);
  const rows: [string, string | undefined][] = [
    ['Booking reference', b.bookingRef],
    ['Lane', b.laneName],
    ['Date', when],
    ['Time', b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : undefined],
    ['Total', formatMoney(b.finalAmount)],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
};

const bookingTableHtml = (b: BookingEmailDetails) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0;">
    ${bookingRows(b)
      .map(
        ([label, value]) =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;">${label}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:bold;">${escapeHtml(value)}</td></tr>`,
      )
      .join('')}
  </table>`;

const bookingTableText = (b: BookingEmailDetails) =>
  bookingRows(b).map(([label, value]) => `${label}: ${value}`);

export const emailTemplates = {
  emailVerification(firstName: string, code: string): EmailContent {
    const subject = `Verify your email — ${BRAND_NAME}`;
    return {
      subject,
      html: layout(
        `Hi ${firstName},`,
        `<p>Here is your 6 digit verification code:</p>
         <p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:16px 0;">${escapeHtml(code)}</p>`,
      ),
      text: textLayout([`Hi ${firstName},`, '', `Your 6 digit verification code is: ${code}`]),
    };
  },

  passwordReset(firstName: string, code: string): EmailContent {
    const subject = `Reset your password — ${BRAND_NAME}`;
    return {
      subject,
      html: layout(
        `Hi ${firstName},`,
        `<p>Use the code below to reset your password:</p>
         <p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:16px 0;">${escapeHtml(code)}</p>
         <p>This code expires in 1 hour. If you did not request this, please ignore this email.</p>`,
      ),
      text: textLayout([
        `Hi ${firstName},`,
        '',
        `Your password reset code is: ${code}`,
        'This code expires in 1 hour. If you did not request this, please ignore this email.',
      ]),
    };
  },

  welcome(firstName: string): EmailContent {
    const url = clientUrl('/lanes');
    return {
      subject: `Welcome to ${BRAND_NAME}`,
      html: layout(
        `Welcome, ${firstName}!`,
        `<p>Your account is ready. You can now book batting and bowling lanes online, manage your bookings and track your membership.</p>`,
        { label: 'Book a lane', url },
      ),
      text: textLayout([
        `Welcome, ${firstName}!`,
        '',
        'Your account is ready. You can now book batting and bowling lanes online, manage your bookings and track your membership.',
        url && `Book a lane: ${url}`,
      ]),
    };
  },

  bookingConfirmed(firstName: string, booking: BookingEmailDetails): EmailContent {
    const url = clientUrl('/panel/bookings');
    return {
      subject: `Booking Confirmed — ${booking.bookingRef}`,
      html: layout(
        `Thank you for booking, ${firstName}!`,
        `<p>Your booking has been confirmed. Here are the details:</p>
         ${bookingTableHtml(booking)}
         <p>Please arrive 10 minutes before your session starts.</p>`,
        { label: 'View my bookings', url },
      ),
      text: textLayout([
        `Thank you for booking, ${firstName}!`,
        '',
        'Your booking has been confirmed. Here are the details:',
        ...bookingTableText(booking),
        '',
        'Please arrive 10 minutes before your session starts.',
        url && `View my bookings: ${url}`,
      ]),
    };
  },

  /**
   * Sent shortly before a session. `reminder` holds strings already formatted in
   * the business timezone, so this template does no time math of its own.
   */
  bookingReminder(
    firstName: string,
    reminder: {
      bookingId: string;
      bookingRef: string;
      laneName?: string;
      date: string; // "Fri, 23 Oct 2026"
      startTime: string; // "2:00 PM"
      duration: string; // "1 hour"
      relativeDay: string; // "today"
    },
  ): EmailContent {
    const url = clientUrl(`/panel/bookings/${encodeURIComponent(reminder.bookingId)}`);
    const where = reminder.laneName ?? 'your lane';
    const intro = `Your session at ${where} starts at ${reminder.startTime} ${reminder.relativeDay}.`;
    const cancelLine =
      'Can’t make it? You can cancel from My bookings before your session starts. Online payments are refunded automatically.';
    const rows: [string, string][] = [
      ['Booking reference', reminder.bookingRef],
      ...(reminder.laneName ? ([['Lane', reminder.laneName]] as [string, string][]) : []),
      ['Date', reminder.date],
      ['Start time', reminder.startTime],
      ['Duration', reminder.duration],
    ];
    return {
      subject: `Reminder: your session starts at ${reminder.startTime} — ${reminder.bookingRef}`,
      html: layout(
        `Hi ${firstName},`,
        `<p>${escapeHtml(intro)}</p>
         <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0;">
           ${rows
             .map(
               ([label, value]) =>
                 `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;">${label}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:bold;">${escapeHtml(value)}</td></tr>`,
             )
             .join('')}
         </table>
         <p>Please arrive 10 minutes before your session starts.</p>
         <p>${escapeHtml(cancelLine)}</p>`,
        { label: 'View booking', url },
      ),
      text: textLayout([
        `Hi ${firstName},`,
        '',
        intro,
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        'Please arrive 10 minutes before your session starts.',
        cancelLine,
        url && `View booking: ${url}`,
      ]),
    };
  },

  bookingCancelled(
    firstName: string,
    booking: BookingEmailDetails,
    opts: { cancelledBy: 'customer' | 'staff'; reason?: string | null; refunded?: boolean },
  ): EmailContent {
    const byLine =
      opts.cancelledBy === 'staff'
        ? 'Your booking was cancelled by our staff.'
        : 'Your booking was cancelled at your request.';
    const refundLine = opts.refunded
      ? 'A refund has been issued to your original payment method and should appear within 5–10 business days.'
      : undefined;
    return {
      subject: `Booking Cancelled — ${booking.bookingRef}`,
      html: layout(
        `Hi ${firstName},`,
        `<p>${byLine}</p>
         ${bookingTableHtml(booking)}
         ${opts.reason ? `<p><strong>Reason:</strong> ${escapeHtml(opts.reason)}</p>` : ''}
         ${refundLine ? `<p>${refundLine}</p>` : ''}
         <p>If you have any questions, just reply to this email.</p>`,
      ),
      text: textLayout([
        `Hi ${firstName},`,
        '',
        byLine,
        ...bookingTableText(booking),
        opts.reason ? `Reason: ${opts.reason}` : undefined,
        refundLine,
        '',
        'If you have any questions, just reply to this email.',
      ]),
    };
  },
};

export { escapeHtml };
