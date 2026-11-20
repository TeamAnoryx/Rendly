/**
 * Send password reset email via SMTP (Nodemailer).
 * If SMTP is not configured, no email is sent (caller may log the link for dev).
 */

import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

// Ensure backend .env is loaded (works when run from workspace or auth-service dir)
const backendEnv = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: backendEnv });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
  const SMTP_SECURE = process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/**
 * Send a password reset email to the given address with the given link.
 * No-op if SMTP is not configured. Logs and swallows errors so the API can still return 200.
 */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const trans = getTransporter();
  if (!trans) {
    console.log("[auth-service] SMTP not configured; password reset email not sent. Configure SMTP_* to send emails.");
    return;
  }
  const APP_NAME = process.env.APP_NAME || "Rendly";
  const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@rendly.app";
  const subject = `${APP_NAME} – Reset your password`;
  const html = `
    <p>You requested a password reset for your ${APP_NAME} account.</p>
    <p><a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;">Reset password</a></p>
    <p>Or copy this link:</p>
    <p style="word-break:break-all;color:#666;">${resetLink}</p>
    <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
  `.trim();
  const text = `You requested a password reset for your ${APP_NAME} account. Open this link to reset your password (expires in 1 hour):\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`;
  try {
    await trans.sendMail({
      from: MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    console.log("[auth-service] Password reset email sent to", to);
  } catch (err) {
    console.error("[auth-service] Failed to send password reset email:", err);
    // Don't throw – API still returns 200 so we don't leak whether the email exists
  }
}

/**
 * Send a plain email (with optional HTML) through the same SMTP settings. Returns false when SMTP
 * is not configured or sending failed; failures are logged, never thrown.
 */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const trans = getTransporter();
  if (!trans) {
    console.warn("[auth-service] SMTP not configured; email not sent:", subject);
    return false;
  }
  const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@rendly.app";
  try {
    await trans.sendMail({ from: MAIL_FROM, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (err) {
    console.error("[auth-service] Failed to send email:", subject, err instanceof Error ? err.message : String(err));
    return false;
  }
}
