/**
 * Security and operations monitoring for the admin console: records events in
 * `security_events`, watches request outcomes for attack patterns and error spikes, and emails
 * the admin (ADMIN_ALERT_EMAIL, falling back to ADMIN_EMAIL) about urgent ones, at most once per
 * kind every ALERT_COOLDOWN_MINUTES (default 15). Raw IP addresses are never stored: only a
 * salted hash, enough to tell repeat offenders apart.
 */
import crypto from "crypto";
import type express from "express";
import { supabase } from "./supabase-users";
import { sendEmail } from "./send-reset-email";

export type Severity = "info" | "warning" | "critical";

const WINDOW_MS = 5 * 60 * 1000;
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Counts events in a sliding window; `hit` returns true the first time the limit is crossed. */
export class WindowCounter {
  private stamps: number[] = [];
  private alertedAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = WINDOW_MS
  ) {}

  hit(now = Date.now()): boolean {
    this.stamps.push(now);
    this.prune(now);
    if (this.stamps.length >= this.limit && now - this.alertedAt > this.windowMs) {
      this.alertedAt = now;
      return true;
    }
    return false;
  }

  count(now = Date.now()): number {
    this.prune(now);
    return this.stamps.length;
  }

  private prune(now: number): void {
    while (this.stamps.length && this.stamps[0] <= now - this.windowMs) this.stamps.shift();
  }
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.JWT_SECRET || "rendly";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

export function adminAlertEmail(): string | null {
  return (process.env.ADMIN_ALERT_EMAIL || process.env.ADMIN_EMAIL || "").trim() || null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const lastAlert = new Map<string, number>();

/** Email the admin about an urgent event, at most once per `kind` per cooldown. */
export async function sendAdminAlert(kind: string, subject: string, detail: string): Promise<boolean> {
  const to = adminAlertEmail();
  if (!to) return false;
  const cooldownMs = envNumber("ALERT_COOLDOWN_MINUTES", 15) * 60_000;
  const now = Date.now();
  if (now - (lastAlert.get(kind) ?? 0) < cooldownMs) return false;
  lastAlert.set(kind, now);
  const when = new Date(now).toISOString();
  const text = `Rendly alert: ${subject}\n\n${detail}\n\nTime (UTC): ${when}\nOpen the admin console's Health page for details.`;
  const html = `<div style="font-family:Arial,sans-serif"><h2 style="color:#b42318;margin:0 0 8px">Rendly alert: ${escapeHtml(subject)}</h2><p>${escapeHtml(detail)}</p><p style="color:#667085">Time (UTC): ${when}<br>Open the admin console's Health page for details.</p></div>`;
  return sendEmail(to, `[Rendly alert] ${subject}`, text, html);
}

/** Store a security event; critical ones also alert the admin by email. Never throws. */
export async function recordSecurityEvent(event: {
  kind: string;
  severity: Severity;
  detail: string;
  ip?: string | null;
  path?: string | null;
  alertSubject?: string;
}): Promise<void> {
  let alerted = false;
  try {
    if (event.severity === "critical") {
      alerted = await sendAdminAlert(event.kind, event.alertSubject ?? event.kind, event.detail);
    }
  } catch (err) {
    console.error("[security] alert failed:", err instanceof Error ? err.message : String(err));
  }
  if (!supabase) return;
  try {
    const { error } = await supabase.from("security_events").insert({
      kind: event.kind.slice(0, 64),
      severity: event.severity,
      detail: event.detail.slice(0, 1000),
      ip_hash: hashIp(event.ip),
      path: event.path ? event.path.slice(0, 200) : null,
      alerted,
    });
    if (error) console.error("[security] event insert failed:", error.message);
  } catch (err) {
    console.error("[security] event insert failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Paths scanners try on every site; a hit is someone probing for weaknesses. */
export const PROBE_PATH = /(\.env|\.git\/|wp-admin|wp-login|phpmyadmin|\.php$|\/etc\/passwd|\.\.\/|\/actuator|\/server-status|\/cgi-bin)/i;

export type RequestStats = {
  requests: number;
  errors5xx: number;
  authFailures: number;
  rateLimited: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  since: string;
};

const STATS_WINDOW_MS = 15 * 60 * 1000;
const MAX_RECENT = 50_000;
const recent: { t: number; status: number; ms: number }[] = [];
const errors5xx = new WindowCounter(envNumber("ALERT_5XX_PER_5MIN", 50));
const rateLimited = new WindowCounter(envNumber("ALERT_RATE_LIMITED_PER_5MIN", 300));
const authFailuresByIp = new Map<string, WindowCounter>();
const AUTH_FAIL_LIMIT = envNumber("ALERT_AUTH_FAILURES_PER_IP_5MIN", 40);

/** Request outcomes over the last 15 minutes (this process), for the admin Health page. */
export function requestStats(now = Date.now()): RequestStats {
  while (recent.length && recent[0].t <= now - STATS_WINDOW_MS) recent.shift();
  const sorted = recent.map((r) => r.ms).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    requests: recent.length,
    errors5xx: recent.filter((r) => r.status >= 500).length,
    authFailures: recent.filter((r) => r.status === 401 || r.status === 403).length,
    rateLimited: recent.filter((r) => r.status === 429).length,
    avgLatencyMs: sorted.length ? Math.round(sum / sorted.length) : 0,
    p95LatencyMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
    since: new Date(now - STATS_WINDOW_MS).toISOString(),
  };
}

function watchAuthFailure(req: express.Request, ip: string | null, now: number): void {
  const ipHash = hashIp(ip) ?? "unknown";
  let counter = authFailuresByIp.get(ipHash);
  if (!counter) {
    if (authFailuresByIp.size > 10_000) authFailuresByIp.clear();
    counter = new WindowCounter(AUTH_FAIL_LIMIT);
    authFailuresByIp.set(ipHash, counter);
  }
  if (counter.hit(now)) {
    void recordSecurityEvent({
      kind: "auth_failure_burst",
      severity: "critical",
      alertSubject: "Repeated failed authentication (possible break-in attempt)",
      detail: `${counter.count(now)} failed authentication requests from one address in 5 minutes. Latest: ${req.method} ${req.path}.`,
      ip,
      path: req.path,
    });
  }
}

/**
 * Express middleware: records each request's outcome and raises events for probing, bursts of
 * failed authentication from one address, rate-limit floods and server error spikes.
 */
export function securityMonitor(getIp: (req: express.Request) => string | null) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const started = Date.now();
    if (PROBE_PATH.test(req.path)) {
      void recordSecurityEvent({ kind: "probe", severity: "warning", detail: `Scanner-style request: ${req.method} ${req.path}`, ip: getIp(req), path: req.path });
    }
    res.on("finish", () => {
      const now = Date.now();
      const status = res.statusCode;
      recent.push({ t: now, status, ms: now - started });
      if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
      if (status >= 500 && errors5xx.hit(now)) {
        void recordSecurityEvent({
          kind: "error_spike",
          severity: "critical",
          alertSubject: "Server error spike",
          detail: `${errors5xx.count(now)} server errors (5xx) in the last 5 minutes on auth-service. Latest: ${req.method} ${req.path}.`,
          path: req.path,
        });
      }
      if (status === 429 && rateLimited.hit(now)) {
        void recordSecurityEvent({
          kind: "rate_limit_flood",
          severity: "critical",
          alertSubject: "Rate-limit flood (possible attack)",
          detail: `${rateLimited.count(now)} requests were rate limited in the last 5 minutes.`,
          path: req.path,
        });
      }
      if (status === 401 || status === 403) watchAuthFailure(req, getIp(req), now);
    });
    next();
  };
}
