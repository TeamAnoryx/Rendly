/**
 * First-party analytics: the public collector the frontend reports page views and time on site
 * to, and the event reader the admin console aggregates (analytics-rules.ts). No cookies and
 * no raw IP addresses: visitors are random ids from the browser, location is the CDN's coarse
 * country/city. Browsers that send Do Not Track are never counted (the frontend checks too).
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { classifyUserAgent, geoFromHeaders, parseCollectInput, type AnalyticsEvent } from "./analytics-rules";
import { recordSecurityEvent, WindowCounter } from "./security";
import { sharedLimiterStore } from "./shared-state";
import { supabase } from "./supabase-users";

const PAGE_SIZE = 1000;
/** Upper bound on events read for one dashboard request. */
export const MAX_EVENTS = 250_000;
const EVENT_COLUMNS = "created_at,type,visitor_id,session_id,user_id,path,referrer,duration_ms,country,city,lat,lon,device,browser,os";

const trafficPeak = new WindowCounter(Number(process.env.ALERT_TRAFFIC_PER_5MIN) || 1000);

type CurrentUserLookup = (req: express.Request) => Promise<{ userId: string } | null>;

/** POST /api/analytics/collect – one event from the browser (JSON, or text/plain from sendBeacon). */
export function registerAnalyticsRoutes(app: express.Express, currentUser: CurrentUserLookup): void {
  const collectLimiter = rateLimit({
    ...sharedLimiterStore("collect"),
    windowMs: 60 * 1000,
    max: Number(process.env.COLLECT_RATE_LIMIT_MAX) || 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).end(),
  });

  app.post("/api/analytics/collect", collectLimiter, express.text({ type: "text/plain", limit: "4kb" }), async (req, res) => {
    let body: unknown = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).end();
        return;
      }
    }
    const input = parseCollectInput(body);
    if (!input) {
      res.status(400).end();
      return;
    }
    if (req.headers.dnt === "1" || req.headers["sec-gpc"] === "1") {
      res.status(204).end();
      return;
    }
    // Answer first: analytics must never slow the page down.
    res.status(204).end();
    try {
      if (!supabase) return;
      const user = await currentUser(req).catch(() => null);
      const ua = classifyUserAgent(req.headers["user-agent"]);
      const geo = geoFromHeaders(req.headers);
      const { error } = await supabase.from("analytics_events").insert({
        ...input,
        user_id: user?.userId ?? null,
        ...geo,
        ...ua,
      });
      if (error) console.error("[analytics] insert failed:", error.message);
      if (input.type === "pageview" && ua.device !== "bot" && trafficPeak.hit()) {
        void recordSecurityEvent({
          kind: "traffic_peak",
          severity: "critical",
          alertSubject: "Traffic peak",
          detail: `${trafficPeak.count()} page views in the last 5 minutes, above the alert threshold. Check that the servers are keeping up.`,
          path: input.path,
        });
      }
    } catch (err) {
      console.error("[analytics] collect failed:", err instanceof Error ? err.message : String(err));
    }
  });
}

/** Events with created_at in [from, to), oldest first, at most MAX_EVENTS. */
export async function fetchEvents(from: Date, to: Date): Promise<{ events: AnalyticsEvent[]; truncated: boolean }> {
  const events: AnalyticsEvent[] = [];
  if (!supabase) return { events, truncated: false };
  for (let offset = 0; offset < MAX_EVENTS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("analytics_events")
      .select(EVENT_COLUMNS)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`analytics_events read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as AnalyticsEvent[];
    for (const r of rows) {
      events.push({ ...r, duration_ms: Number(r.duration_ms) || 0, lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon) });
    }
    if (rows.length < PAGE_SIZE) return { events, truncated: false };
  }
  return { events, truncated: true };
}
