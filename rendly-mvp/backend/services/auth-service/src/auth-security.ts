/**
 * Security helpers for auth-service: signing secret, client address, password-reset tokens,
 * reset-link origin, profile URL checks, rate-limit keys and response headers. Pure where
 * possible so each rule is unit tested.
 */
import crypto from "crypto";
import type express from "express";

const DEV_JWT_SECRET = "dev-secret-change-in-production";
const LOCAL_APP_ORIGIN = "http://localhost:3001";
const MAX_PROFILE_URL_LENGTH = 300;

/**
 * The JWT signing secret. In production a missing secret stops the service: a well-known
 * fallback would let anyone sign a valid session for any user.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.JWT_SECRET;
  if (value) return value;
  if (env.NODE_ENV === "production") throw new Error("JWT_SECRET is not set");
  return DEV_JWT_SECRET;
}

/**
 * The caller's address as Express resolved it through the trusted proxy. Client-supplied
 * values (body fields, X-Client-IP, raw X-Forwarded-For) are never used: anyone can forge
 * them to dodge lockouts or poison the security log.
 */
export function clientIp(req: Pick<express.Request, "ip" | "socket">): string | null {
  const ip = typeof req.ip === "string" ? req.ip.trim() : "";
  if (ip) return ip;
  const remote = req.socket?.remoteAddress;
  return typeof remote === "string" && remote.trim() ? remote.trim() : null;
}

/** Deterministic hash of a password-reset token, so the row is found with one indexed lookup. */
export function resetTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Origin used in password-reset links. Production uses APP_URL only: building the link from
 * request headers would let an attacker send a victim a real token pointing at their own site.
 * Returns null when production has no APP_URL (the caller must not send a link).
 */
export function resolveAppOrigin(
  env: NodeJS.ProcessEnv,
  headers: { origin?: string | string[]; referer?: string | string[] }
): string | null {
  const configured = (env.APP_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (env.NODE_ENV === "production") return null;
  const fromHeader = [headers.origin, headers.referer].find((h): h is string => typeof h === "string" && h.length > 0);
  return (fromHeader || LOCAL_APP_ORIGIN).replace(/\/$/, "");
}

/** A profile link must be a plain https URL (no javascript:, data: or credentials). */
export function isSafeProfileUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > MAX_PROFILE_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Rate-limit key: the verified token's subject, else the caller's address. An unverified
 * Authorization header never forms a key, so random headers cannot mint fresh budgets.
 */
export function rateLimitKey(authorization: unknown, ip: string | null | undefined, verifySubject: (token: string) => string | null): string {
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const subject = verifySubject(authorization.slice(7));
    if (subject) return `u:${subject}`;
  }
  return `ip:${ip || "unknown"}`;
}

/** Baseline response headers for a JSON API (set by hand; no extra dependency). */
export function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
