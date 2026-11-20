/**
 * Admin console API (`/api/admin/*`): sign-in, analytics overview, feature usage, the contact
 * query inbox with replies, service health, security events and monthly / quarterly reports.
 * Every route except login requires an admin token (admin-auth.ts).
 */
import express from "express";
import rateLimit from "express-rate-limit";
import {
  checkAdminCredentials,
  lockoutRemaining,
  recordAdminLoginFailure,
  recordAdminLoginSuccess,
  requireAdmin,
  adminConfig,
  signAdminToken,
} from "./admin-auth";
import { buildDashboard, periodFor, reportPeriod, usageStats, type Period } from "./analytics-rules";
import { fetchEvents } from "./analytics";
import { requestStats } from "./security";
import { sendEmail } from "./send-reset-email";
import { sharedLimiterStore } from "./shared-state";
import { supabase } from "./supabase-users";
import { chatServiceUrl, RENDLY_TEAM_USER_ID, sendTeamMessage } from "./team";

const DAY_MS = 86_400_000;
const ROW_CAP = 50_000;
const QUERY_STATUSES = ["open", "answered", "closed"] as const;

type Deps = { getIp: (req: express.Request) => string | null };

function tzOffset(raw: unknown): number {
  // Browsers report getTimezoneOffset() (minutes behind UTC); the rules want minutes ahead.
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? -Math.round(n) : 0;
}

async function countRows(table: string, build: (q: any) => any): Promise<number | null> {
  if (!supabase) return null;
  const { count, error } = await build(supabase.from(table).select("*", { count: "exact", head: true }));
  if (error) {
    console.error(`[admin] count ${table} failed:`, error.message);
    return null;
  }
  return count ?? 0;
}

async function rowsInRange<T>(table: string, columns: string, timeColumn: string, from: Date, to: Date): Promise<T[]> {
  if (!supabase) return [];
  const out: T[] = [];
  for (let offset = 0; offset < ROW_CAP; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte(timeColumn, from.toISOString())
      .lt(timeColumn, to.toISOString())
      .range(offset, offset + 999);
    if (error) {
      console.error(`[admin] read ${table} failed:`, error.message);
      return out;
    }
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Usage of Whispers, groups, Huddles and Spark in [from, to), plus totals right now. */
export async function featureStats(from: Date, to: Date) {
  const notTeam = (id: string | null | undefined) => !!id && id !== RENDLY_TEAM_USER_ID;
  const [whispers, huddles, sparks, groupMessages, totalUsers, newUsers, liveHuddles] = await Promise.all([
    rowsInRange<{ created_at: string; message: { sent_by_id?: string } | null }>("whisper_messages", "created_at,message", "created_at", from, to),
    rowsInRange<{ created_at: string; created_by: string }>("huddles", "created_at,created_by", "created_at", from, to),
    rowsInRange<{ enqueued_at: string; user_id: string; status: string }>("match_queue", "enqueued_at,user_id,status", "enqueued_at", from, to),
    countRows("group_messages", (q) => q.gte("created_at", from.toISOString()).lt("created_at", to.toISOString())),
    countRows("users", (q) => q.neq("id", RENDLY_TEAM_USER_ID)),
    countRows("users", (q) => q.neq("id", RENDLY_TEAM_USER_ID).gte("created_at", from.toISOString()).lt("created_at", to.toISOString())),
    countRows("huddles", (q) => q.eq("is_active", true).not("started_at", "is", null).is("ended_at", null)),
  ]);
  const whisperUse = whispers
    .map((w) => ({ user: w.message?.sent_by_id ?? "", at: w.created_at }))
    .filter((w) => notTeam(w.user));
  const sparkUse = sparks.map((s) => ({ user: s.user_id, at: s.enqueued_at }));
  return {
    totalUsers,
    newUsers,
    whispers: { messages: whisperUse.length, ...usageStats(whisperUse) },
    groups: { messages: groupMessages },
    huddles: { created: huddles.length, liveNow: liveHuddles, ...usageStats(huddles.map((h) => ({ user: h.created_by, at: h.created_at }))) },
    spark: {
      searches: sparks.length,
      matched: sparks.filter((s) => s.status === "matched").length,
      ...usageStats(sparkUse),
    },
  };
}

async function serviceHealth() {
  const check = async (name: string, fn: () => Promise<void>) => {
    const started = Date.now();
    try {
      await fn();
      return { name, ok: true, latencyMs: Date.now() - started, detail: "Responding" };
    } catch (err) {
      return { name, ok: false, latencyMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) };
    }
  };
  const services = await Promise.all([
    check("Auth & API service", async () => undefined),
    check("Chat, calls & Huddles service", async () => {
      const r = await fetch(`${chatServiceUrl()}/health`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }),
    check("Database", async () => {
      if (!supabase) throw new Error("Not configured");
      const { error } = await supabase.from("users").select("id").limit(1);
      if (error) throw new Error(error.message);
    }),
    check("Email alerts (SMTP)", async () => {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER) throw new Error("SMTP not configured: alerts cannot be emailed");
    }),
  ]);
  return { services, requests: requestStats(), checkedAt: new Date().toISOString() };
}

async function securitySummary(from: Date, to: Date, limit = 50) {
  if (!supabase) return { events: [], bySeverity: { info: 0, warning: 0, critical: 0 }, byKind: [] as { kind: string; count: number }[] };
  const { data, error } = await supabase
    .from("security_events")
    .select("created_at,kind,severity,detail,path,alerted")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`security_events read failed: ${error.message}`);
  const rows = (data ?? []) as { created_at: string; kind: string; severity: "info" | "warning" | "critical"; detail: string; path: string | null; alerted: boolean }[];
  const bySeverity = { info: 0, warning: 0, critical: 0 };
  const kinds = new Map<string, number>();
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  }
  return {
    events: rows.slice(0, limit),
    bySeverity,
    byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
  };
}

async function querySummary(from?: Date, to?: Date) {
  const counts: Record<string, number | null> = {};
  for (const status of QUERY_STATUSES) {
    counts[status] = await countRows("contact_requests", (q) => {
      let x = q.eq("status", status);
      if (from && to) x = x.gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
      return x;
    });
  }
  return counts;
}

/** Dashboard for [period.from, period.to) with the previous window and DAU/WAU/MAU. */
async function dashboardFor(period: Period, tz: number) {
  const span = period.to.getTime() - period.from.getTime();
  const earliest = new Date(Math.min(period.from.getTime() - span, period.to.getTime() - 30 * DAY_MS));
  const { events, truncated } = await fetchEvents(earliest, period.to);
  const at = (e: { created_at: string }) => Date.parse(e.created_at);
  const current = events.filter((e) => at(e) >= period.from.getTime());
  const previous = events.filter((e) => at(e) < period.from.getTime() && at(e) >= period.from.getTime() - span);
  const lastMonth = events.filter((e) => at(e) >= period.to.getTime() - 30 * DAY_MS);
  const liveSince = Date.now() - 2 * 60_000;
  const liveVisitors = new Set(events.filter((e) => at(e) >= liveSince).map((e) => e.visitor_id)).size;
  return { ...buildDashboard(current, previous, lastMonth, period, tz), liveVisitors, truncated };
}

export function registerAdminRoutes(app: express.Express, deps: Deps): void {
  const loginLimiter = rateLimit({
    ...sharedLimiterStore("admin-login"),
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX) || 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ message: "Too many sign-in attempts. Wait 15 minutes and try again." }),
  });

  app.post("/api/admin/login", loginLimiter, async (req, res) => {
    const ip = deps.getIp(req);
    if (!adminConfig()) {
      res.status(503).json({ message: "Admin sign-in is not configured on the server (ADMIN_EMAIL, ADMIN_PASSWORD_HASH)." });
      return;
    }
    const wait = lockoutRemaining(ip);
    if (wait > 0) {
      res.status(429).json({ message: `Too many wrong attempts. Try again in ${Math.ceil(wait / 60_000)} minutes.` });
      return;
    }
    try {
      const { email, password } = req.body ?? {};
      if (!(await checkAdminCredentials(email, password))) {
        recordAdminLoginFailure(ip);
        res.status(401).json({ message: "Wrong admin email or password." });
        return;
      }
      recordAdminLoginSuccess(ip);
      res.json({ token: signAdminToken(String(email).trim().toLowerCase()), expiresInSeconds: 8 * 3600 });
    } catch (err) {
      console.error("[admin] login failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Sign-in failed. Try again." });
    }
  });

  app.get("/api/admin/me", requireAdmin, (req: express.Request & { adminEmail?: string }, res) => {
    res.json({ email: req.adminEmail });
  });

  app.get("/api/admin/overview", requireAdmin, async (req, res) => {
    try {
      res.json(await dashboardFor(periodFor(req.query.range), tzOffset(req.query.tz)));
    } catch (err) {
      console.error("[admin] overview failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not load analytics." });
    }
  });

  app.get("/api/admin/features", requireAdmin, async (req, res) => {
    try {
      const p = periodFor(req.query.range);
      res.json(await featureStats(p.from, p.to));
    } catch (err) {
      console.error("[admin] features failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not load feature usage." });
    }
  });

  app.get("/api/admin/queries", requireAdmin, async (req, res) => {
    if (!supabase) {
      res.status(503).json({ message: "Database not configured" });
      return;
    }
    try {
      const status = String(req.query.status ?? "open");
      let q = supabase
        .from("contact_requests")
        .select("id,user_id,name,email,subject,category,source,message,status,reply,replied_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if ((QUERY_STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      res.json({ queries: data ?? [], counts: await querySummary() });
    } catch (err) {
      console.error("[admin] queries failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not load queries." });
    }
  });

  app.post("/api/admin/queries/:id/reply", requireAdmin, async (req, res) => {
    if (!supabase) {
      res.status(503).json({ message: "Database not configured" });
      return;
    }
    const reply = typeof req.body?.reply === "string" ? req.body.reply.trim().slice(0, 4000) : "";
    if (!reply) {
      res.status(400).json({ message: "Write a reply first." });
      return;
    }
    try {
      const { data: row, error } = await supabase
        .from("contact_requests")
        .select("id,user_id,email,name,message")
        .eq("id", req.params.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) {
        res.status(404).json({ message: "Query not found" });
        return;
      }
      const r = row as { id: string; user_id: string | null; email: string; name: string; message: string };
      const quoted = r.message.length > 140 ? `${r.message.slice(0, 139)}…` : r.message;
      let deliveredInApp = false;
      if (r.user_id) deliveredInApp = await sendTeamMessage(r.user_id, `Re: "${quoted}"\n\n${reply}`);
      let emailed = false;
      if (!deliveredInApp && r.email && /@/.test(r.email) && !r.email.endsWith(".invalid")) {
        emailed = await sendEmail(r.email, "Rendly – reply to your message", `Hi ${r.name},\n\nYou wrote: "${quoted}"\n\n${reply}\n\n– The Rendly Team`);
      }
      if (!deliveredInApp && !emailed) {
        res.status(502).json({ message: "The reply could not be delivered (chat service or email unavailable). Nothing was marked answered." });
        return;
      }
      const { error: updateError } = await supabase
        .from("contact_requests")
        .update({ reply, replied_at: new Date().toISOString(), status: "answered" })
        .eq("id", r.id);
      if (updateError) throw new Error(updateError.message);
      res.json({ ok: true, deliveredInApp, emailed });
    } catch (err) {
      console.error("[admin] reply failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not send the reply." });
    }
  });

  app.patch("/api/admin/queries/:id", requireAdmin, async (req, res) => {
    const status = req.body?.status;
    if (!supabase || !(QUERY_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ message: "Status must be open, answered or closed." });
      return;
    }
    const { error } = await supabase.from("contact_requests").update({ status }).eq("id", req.params.id);
    if (error) {
      console.error("[admin] status update failed:", error.message);
      res.status(500).json({ message: "Could not update the query." });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/health", requireAdmin, async (_req, res) => {
    try {
      const now = new Date();
      const [health, security] = await Promise.all([serviceHealth(), securitySummary(new Date(now.getTime() - 7 * DAY_MS), now)]);
      res.json({ ...health, security });
    } catch (err) {
      console.error("[admin] health failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not load health." });
    }
  });

  app.get("/api/admin/report", requireAdmin, async (req, res) => {
    try {
      const kind = req.query.kind === "quarter" ? "quarter" : "month";
      const now = new Date();
      const year = Number(req.query.year) || now.getUTCFullYear();
      const index = req.query.index !== undefined ? Number(req.query.index) : kind === "month" ? now.getUTCMonth() : Math.floor(now.getUTCMonth() / 3);
      const rp = reportPeriod(kind, year, Number.isFinite(index) ? index : 0);
      const to = rp.to.getTime() > now.getTime() ? now : rp.to;
      const period: Period = { name: kind === "month" ? "month" : "quarter", from: rp.from, to, bucket: "day" };
      const [dashboard, features, queries, security, health] = await Promise.all([
        dashboardFor(period, tzOffset(req.query.tz)),
        featureStats(rp.from, to),
        querySummary(rp.from, to),
        securitySummary(rp.from, to, 20),
        serviceHealth(),
      ]);
      res.json({
        kind,
        label: rp.label,
        from: rp.from.toISOString(),
        to: to.toISOString(),
        generatedAt: now.toISOString(),
        dashboard,
        features,
        queries,
        security,
        health,
      });
    } catch (err) {
      console.error("[admin] report failed:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ message: "Could not build the report." });
    }
  });
}
