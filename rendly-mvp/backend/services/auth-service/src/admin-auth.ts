/**
 * Admin console sign-in. The admin account is not a row in `users`: its email comes from
 * ADMIN_EMAIL and its password from ADMIN_PASSWORD (plain text, set in the host environment) or a
 * bcrypt hash in ADMIN_PASSWORD_HASH (`npm run admin:hash-password`), which wins when both are set.
 * Admin tokens are JWTs for the audience
 * "rendly-admin", so ordinary user tokens can never open admin routes.
 *
 * Failed attempts lock the address out for 15 minutes after 5 failures and alert the admin by
 * email on a burst (see security.ts).
 */
import crypto from "crypto";
import type express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { hashIp, recordSecurityEvent, WindowCounter } from "./security";

export const ADMIN_AUDIENCE = "rendly-admin";
const TOKEN_TTL = "8h";
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
/** Compared against when the email is wrong, so a wrong email costs as much time as a wrong password. */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7zhn5OzS9jbqTIXbsl3Xxw1V3H9hK5K";

const secret = (): string => process.env.JWT_SECRET || "dev-secret-change-in-production";

export type AdminConfig = { email: string; passwordHash: string | null; password: string | null };

/**
 * The admin account from the environment. ADMIN_PASSWORD_HASH (bcrypt) wins when set;
 * otherwise the plain-text ADMIN_PASSWORD is used. Never put either value in source code.
 */
export function adminConfig(): AdminConfig | null {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const rawHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
  const passwordHash = /^\$2[aby]\$\d{2}\$/.test(rawHash) ? rawHash : null;
  const password = process.env.ADMIN_PASSWORD || null;
  if (!email || (!passwordHash && !password)) return null;
  return { email, passwordHash, password: passwordHash ? null : password };
}

function sameText(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** True when the email and password match the configured admin. Always spends one bcrypt compare. */
export async function checkAdminCredentials(email: unknown, password: unknown): Promise<boolean> {
  const cfg = adminConfig();
  if (!cfg || typeof email !== "string" || typeof password !== "string" || !password || password.length > 200) return false;
  const emailOk = sameText(email.trim().toLowerCase(), cfg.email);
  const passwordOk = cfg.passwordHash
    ? await bcrypt.compare(password, emailOk ? cfg.passwordHash : DUMMY_HASH)
    : sameText(password, cfg.password ?? "");
  return emailOk && passwordOk;
}

export function signAdminToken(email: string): string {
  return jwt.sign({ sub: email, role: "admin" }, secret(), { audience: ADMIN_AUDIENCE, expiresIn: TOKEN_TTL });
}

/** The admin email in a valid admin token, else null. */
export function verifyAdminToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret(), { audience: ADMIN_AUDIENCE }) as { sub?: string; role?: string };
    const cfg = adminConfig();
    if (decoded.role !== "admin" || !decoded.sub || !cfg || decoded.sub !== cfg.email) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

export function bearer(req: express.Request): string | null {
  const h = req.headers.authorization;
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Middleware: 401 unless the request carries a valid admin token. */
export function requireAdmin(req: express.Request & { adminEmail?: string }, res: express.Response, next: express.NextFunction): void {
  const email = verifyAdminToken(bearer(req));
  if (!email) {
    res.status(401).json({ message: "Admin sign-in required" });
    return;
  }
  req.adminEmail = email;
  next();
}

type Failures = { count: number; lockedUntil: number };
const failures = new Map<string, Failures>();
const globalFailures = new WindowCounter(20, 15 * 60 * 1000);

/** Milliseconds left on this address's lockout, or 0. */
export function lockoutRemaining(ip: string | null, now = Date.now()): number {
  const f = failures.get(hashIp(ip) ?? "unknown");
  return f && f.lockedUntil > now ? f.lockedUntil - now : 0;
}

export function recordAdminLoginFailure(ip: string | null, now = Date.now()): void {
  const key = hashIp(ip) ?? "unknown";
  const f = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILURES) {
    f.lockedUntil = now + LOCKOUT_MS;
    f.count = 0;
    void recordSecurityEvent({
      kind: "admin_login_lockout",
      severity: "critical",
      alertSubject: "Admin login locked after repeated wrong passwords",
      detail: `${MAX_FAILURES} wrong admin sign-in attempts from one address; it is locked out for 15 minutes.`,
      ip,
      path: "/api/admin/login",
    });
  } else {
    void recordSecurityEvent({ kind: "admin_login_failed", severity: "warning", detail: "Wrong admin email or password.", ip, path: "/api/admin/login" });
  }
  failures.set(key, f);
  if (failures.size > 10_000) failures.clear();
  if (globalFailures.hit(now)) {
    void recordSecurityEvent({
      kind: "admin_bruteforce",
      severity: "critical",
      alertSubject: "Possible brute-force attack on the admin console",
      detail: "20 or more failed admin sign-ins in 15 minutes across addresses.",
      path: "/api/admin/login",
    });
  }
}

export function recordAdminLoginSuccess(ip: string | null): void {
  failures.delete(hashIp(ip) ?? "unknown");
  void recordSecurityEvent({ kind: "admin_login", severity: "info", detail: "Admin signed in.", ip, path: "/api/admin/login" });
}
