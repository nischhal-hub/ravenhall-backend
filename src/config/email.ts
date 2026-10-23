import nodemailer from "nodemailer";

const smtpPort = Number(process.env.SMTP_PORT) || 465;

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const EMAIL_FROM = `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`;

// Set EMAIL_ENABLED=false to log emails instead of sending them (local dev / CI)
export const isEmailEnabled = () => process.env.EMAIL_ENABLED !== "false";
