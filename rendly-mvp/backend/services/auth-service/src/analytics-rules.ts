/**
 * Pure rules for the admin analytics dashboard: input validation for the collector, user-agent
 * classification, period ranges and the aggregation of raw events into dashboard numbers.
 * No I/O here, so every rule is unit tested (analytics-rules.test.ts).
 */

export const EVENT_TYPES = ["pageview", "heartbeat", "app_open", "signin", "signup"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type AnalyticsEvent = {
  created_at: string;
  type: EventType;
  visitor_id: string;
  session_id: string;
  user_id: string | null;
  path: string;
  referrer: string | null;
  duration_ms: number;
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  device: string | null;
  browser: string | null;
  os: string | null;
};

export type CollectInput = {
  type: EventType;
  visitor_id: string;
  session_id: string;
  path: string;
  referrer: string | null;
  utm_source: string | null;
  duration_ms: number;
};

/** Heartbeats are sent every 15 s while the page is visible; one can never claim more than this. */
export const MAX_HEARTBEAT_MS = 60_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Validate a collector body. Returns null when it is not a usable event. */
export function parseCollectInput(body: unknown): CollectInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const type = b.type;
  if (typeof type !== "string" || !(EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (typeof b.visitor_id !== "string" || !ID_PATTERN.test(b.visitor_id)) return null;
  if (typeof b.session_id !== "string" || !ID_PATTERN.test(b.session_id)) return null;
  const path = typeof b.path === "string" && b.path.startsWith("/") ? b.path.split(/[?#]/)[0].slice(0, 200) : "/";
  const referrer = cleanReferrer(b.referrer);
  const utm = typeof b.utm_source === "string" ? b.utm_source.trim().slice(0, 64) || null : null;
  const rawDuration = typeof b.duration_ms === "number" && Number.isFinite(b.duration_ms) ? b.duration_ms : 0;
  const duration_ms = type === "heartbeat" ? Math.max(0, Math.min(MAX_HEARTBEAT_MS, Math.round(rawDuration))) : 0;
  return { type: type as EventType, visitor_id: b.visitor_id, session_id: b.session_id, path, referrer, utm_source: utm, duration_ms };
}

/** Keep only the referring host (no paths or query strings, which can carry personal data). */
export function cleanReferrer(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export type DeviceInfo = { device: "mobile" | "tablet" | "desktop" | "bot"; browser: string; os: string };

/** Coarse device / browser / OS from a user-agent string. */
export function classifyUserAgent(ua: string | undefined): DeviceInfo {
  const s = ua ?? "";
  const bot = /bot|crawler|spider|crawling|headless|lighthouse|preview/i.test(s);
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(s);
  const mobile = /mobi|iphone|ipod|android.*mobile/i.test(s);
  const device: DeviceInfo["device"] = bot ? "bot" : tablet ? "tablet" : mobile ? "mobile" : "desktop";
  const browser = /edg\//i.test(s)
    ? "Edge"
    : /opr\/|opera/i.test(s)
      ? "Opera"
      : /samsungbrowser/i.test(s)
        ? "Samsung Internet"
        : /firefox|fxios/i.test(s)
          ? "Firefox"
          : /chrome|crios/i.test(s)
            ? "Chrome"
            : /safari/i.test(s)
              ? "Safari"
              : "Other";
  const os = /windows/i.test(s)
    ? "Windows"
    : /iphone|ipad|ipod|ios/i.test(s)
      ? "iOS"
      : /android/i.test(s)
        ? "Android"
        : /mac os x|macintosh/i.test(s)
          ? "macOS"
          : /linux/i.test(s)
            ? "Linux"
            : "Other";
  return { device, browser, os };
}

/** Country / city / rounded location from CDN geo headers (Vercel, Cloudflare, CloudFront). */
export function geoFromHeaders(h: Record<string, string | string[] | undefined>): {
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
} {
  const one = (k: string): string | undefined => {
    const v = h[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const rawCountry = one("x-vercel-ip-country") ?? one("cf-ipcountry") ?? one("cloudfront-viewer-country");
  const country = rawCountry && /^[A-Za-z]{2}$/.test(rawCountry) && rawCountry.toUpperCase() !== "XX" ? rawCountry.toUpperCase() : null;
  let city: string | null = null;
  const rawCity = one("x-vercel-ip-city") ?? one("cf-ipcity") ?? one("cloudfront-viewer-city");
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity).slice(0, 80) || null;
    } catch {
      city = rawCity.slice(0, 80) || null;
    }
  }
  const round = (v: string | undefined): number | null => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  };
  return {
    country,
    city,
    lat: round(one("x-vercel-ip-latitude") ?? one("cf-iplatitude") ?? one("cloudfront-viewer-latitude")),
    lon: round(one("x-vercel-ip-longitude") ?? one("cf-iplongitude") ?? one("cloudfront-viewer-longitude")),
  };
}

export const RANGES = ["day", "week", "month", "quarter"] as const;
export type RangeName = (typeof RANGES)[number];
const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<RangeName, number> = { day: 1, week: 7, month: 30, quarter: 91 };

export type Period = { from: Date; to: Date; bucket: "hour" | "day"; name: RangeName };

/** The window ending at `now` for a dashboard range. */
export function periodFor(range: unknown, now = new Date()): Period {
  const name: RangeName = (RANGES as readonly unknown[]).includes(range) ? (range as RangeName) : "week";
  return { name, to: now, from: new Date(now.getTime() - RANGE_DAYS[name] * DAY_MS), bucket: name === "day" ? "hour" : "day" };
}

/** A calendar month (index 0-11) or quarter (index 0-3) in UTC, with a readable label. */
export function reportPeriod(kind: "month" | "quarter", year: number, index: number): { from: Date; to: Date; label: string } {
  if (kind === "month") {
    const m = Math.min(11, Math.max(0, index));
    const from = new Date(Date.UTC(year, m, 1));
    const to = new Date(Date.UTC(year, m + 1, 1));
    return { from, to, label: from.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const q = Math.min(3, Math.max(0, index));
  const from = new Date(Date.UTC(year, q * 3, 1));
  const to = new Date(Date.UTC(year, q * 3 + 3, 1));
  return { from, to, label: `Q${q + 1} ${year}` };
}

type Counted = { key: string; count: number };

function topN(map: Map<string, number>, n: number): Counted[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

function bump(map: Map<string, number>, key: string | null | undefined, by = 1): void {
  const k = key && key.trim() ? key : "Unknown";
  map.set(k, (map.get(k) ?? 0) + by);
}

function bucketStart(t: number, bucket: "hour" | "day"): number {
  const size = bucket === "hour" ? 3_600_000 : DAY_MS;
  return Math.floor(t / size) * size;
}

export type Summary = {
  visitors: number;
  sessions: number;
  pageviews: number;
  appOpens: number;
  signins: number;
  signups: number;
  activeUsers: number;
  watchTimeMs: number;
  avgSessionMs: number;
  bounceRate: number;
  returningRate: number;
  pagesPerSession: number;
};

export type Dashboard = {
  summary: Summary;
  previous: Summary;
  series: { t: string; visitors: number; pageviews: number; signins: number }[];
  hourOfDay: number[];
  dayOfWeek: number[];
  peak: { hour: number; day: string | null; dayVisitors: number };
  lowest: { hour: number; day: string | null; dayVisitors: number };
  pages: { path: string; views: number; visitors: number; avgTimeMs: number }[];
  referrers: Counted[];
  countries: Counted[];
  cities: { key: string; country: string | null; count: number; lat: number | null; lon: number | null }[];
  devices: Counted[];
  browsers: Counted[];
  os: Counted[];
  activeUsers: { daily: number; weekly: number; monthly: number };
};

/** Totals for one window of events. */
export function summarise(events: AnalyticsEvent[]): Summary {
  const visitors = new Set<string>();
  const sessions = new Map<string, { pageviews: number; durationMs: number }>();
  const visitorDays = new Map<string, Set<string>>();
  const users = new Set<string>();
  let pageviews = 0;
  let appOpens = 0;
  let signins = 0;
  let signups = 0;
  let watchTimeMs = 0;
  for (const e of events) {
    visitors.add(e.visitor_id);
    const s = sessions.get(e.session_id) ?? { pageviews: 0, durationMs: 0 };
    if (e.user_id) users.add(e.user_id);
    const days = visitorDays.get(e.visitor_id) ?? new Set<string>();
    days.add(e.created_at.slice(0, 10));
    visitorDays.set(e.visitor_id, days);
    if (e.type === "pageview") {
      pageviews++;
      s.pageviews++;
    } else if (e.type === "heartbeat") {
      s.durationMs += e.duration_ms;
      watchTimeMs += e.duration_ms;
    } else if (e.type === "app_open") appOpens++;
    else if (e.type === "signin") signins++;
    else if (e.type === "signup") signups++;
    sessions.set(e.session_id, s);
  }
  const sessionList = [...sessions.values()];
  const bounces = sessionList.filter((s) => s.pageviews <= 1 && s.durationMs < 10_000).length;
  const returning = [...visitorDays.values()].filter((d) => d.size >= 2).length;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    visitors: visitors.size,
    sessions: sessions.size,
    pageviews,
    appOpens: appOpens || sessions.size,
    signins,
    signups,
    activeUsers: users.size,
    watchTimeMs,
    avgSessionMs: Math.round(ratio(watchTimeMs, sessions.size)),
    bounceRate: ratio(bounces, sessions.size),
    returningRate: ratio(returning, visitors.size),
    pagesPerSession: ratio(pageviews, sessions.size),
  };
}

/** Distinct signed-in users seen in the `days` days before `now`. */
export function activeUsersWithin(events: AnalyticsEvent[], now: Date, days: number): number {
  const since = now.getTime() - days * DAY_MS;
  const ids = new Set<string>();
  for (const e of events) if (e.user_id && Date.parse(e.created_at) >= since) ids.add(e.user_id);
  return ids.size;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(day: string): string {
  return `${day} (${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;
}

/**
 * Everything the dashboard shows for one period. `events` covers the period, `previous` the
 * same-length window before it, `lastMonth` the 30 days before `period.to` (for DAU/WAU/MAU).
 * Hours and weekdays are in UTC shifted by `tzOffsetMinutes` (the admin's browser time zone).
 */
export function buildDashboard(
  events: AnalyticsEvent[],
  previous: AnalyticsEvent[],
  lastMonth: AnalyticsEvent[],
  period: Period,
  tzOffsetMinutes = 0
): Dashboard {
  const offsetMs = tzOffsetMinutes * 60_000;
  const step = period.bucket === "hour" ? 3_600_000 : DAY_MS;
  const humans = events.filter((e) => e.device !== "bot");
  const series = new Map<number, { visitors: Set<string>; pageviews: number; signins: number }>();
  for (let t = bucketStart(period.from.getTime() + offsetMs, period.bucket); t <= period.to.getTime() + offsetMs; t += step) {
    series.set(t, { visitors: new Set(), pageviews: 0, signins: 0 });
  }
  const hourVisitors = Array.from({ length: 24 }, () => new Set<string>());
  const weekdayVisitors = Array.from({ length: 7 }, () => new Set<string>());
  const dayVisitors = new Map<string, Set<string>>();
  const pages = new Map<string, { views: number; visitors: Set<string>; timeMs: number }>();
  const referrers = new Map<string, number>();
  const countries = new Map<string, number>();
  const cities = new Map<string, { country: string | null; count: number; lat: number | null; lon: number | null }>();
  const devices = new Map<string, number>();
  const browsers = new Map<string, number>();
  const oses = new Map<string, number>();
  const seenVisitor = new Set<string>();

  for (const e of humans) {
    const local = Date.parse(e.created_at) + offsetMs;
    const slot = series.get(bucketStart(local, period.bucket));
    const d = new Date(local);
    hourVisitors[d.getUTCHours()].add(e.visitor_id);
    weekdayVisitors[d.getUTCDay()].add(e.visitor_id);
    const dayKey = d.toISOString().slice(0, 10);
    const dv = dayVisitors.get(dayKey) ?? new Set<string>();
    dv.add(e.visitor_id);
    dayVisitors.set(dayKey, dv);
    if (slot) slot.visitors.add(e.visitor_id);
    const page = pages.get(e.path) ?? { views: 0, visitors: new Set<string>(), timeMs: 0 };
    if (e.type === "pageview") {
      page.views++;
      page.visitors.add(e.visitor_id);
      if (slot) slot.pageviews++;
      if (e.referrer) bump(referrers, e.referrer);
    } else if (e.type === "heartbeat") page.timeMs += e.duration_ms;
    else if (e.type === "signin" && slot) slot.signins++;
    pages.set(e.path, page);
    if (!seenVisitor.has(e.visitor_id)) {
      seenVisitor.add(e.visitor_id);
      bump(countries, e.country);
      bump(devices, e.device);
      bump(browsers, e.browser);
      bump(oses, e.os);
      if (e.city) {
        const key = `${e.city}|${e.country ?? ""}`;
        const c = cities.get(key) ?? { country: e.country, count: 0, lat: e.lat, lon: e.lon };
        c.count++;
        cities.set(key, c);
      }
    }
  }

  const hourOfDay = hourVisitors.map((s) => s.size);
  const dayOfWeek = weekdayVisitors.map((s) => s.size);
  const dayCounts = [...dayVisitors.entries()].map(([day, s]) => ({ day, n: s.size }));
  const peakDay = dayCounts.reduce<{ day: string; n: number } | null>((a, b) => (!a || b.n > a.n ? b : a), null);
  const lowDay = dayCounts.reduce<{ day: string; n: number } | null>((a, b) => (!a || b.n < a.n ? b : a), null);

  return {
    summary: summarise(humans),
    previous: summarise(previous.filter((e) => e.device !== "bot")),
    series: [...series.entries()].map(([t, v]) => ({
      t: new Date(t).toISOString(),
      visitors: v.visitors.size,
      pageviews: v.pageviews,
      signins: v.signins,
    })),
    hourOfDay,
    dayOfWeek,
    peak: { hour: hourOfDay.indexOf(Math.max(...hourOfDay)), day: peakDay ? dayLabel(peakDay.day) : null, dayVisitors: peakDay?.n ?? 0 },
    lowest: { hour: hourOfDay.indexOf(Math.min(...hourOfDay)), day: lowDay ? dayLabel(lowDay.day) : null, dayVisitors: lowDay?.n ?? 0 },
    pages: [...pages.entries()]
      .map(([path, p]) => ({ path, views: p.views, visitors: p.visitors.size, avgTimeMs: p.visitors.size ? Math.round(p.timeMs / p.visitors.size) : 0 }))
      .filter((p) => p.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 15),
    referrers: topN(referrers, 10),
    countries: topN(countries, 15),
    cities: [...cities.entries()]
      .map(([key, c]) => ({ key: key.split("|")[0], ...c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    devices: topN(devices, 5),
    browsers: topN(browsers, 6),
    os: topN(oses, 6),
    activeUsers: {
      daily: activeUsersWithin(lastMonth, period.to, 1),
      weekly: activeUsersWithin(lastMonth, period.to, 7),
      monthly: activeUsersWithin(lastMonth, period.to, 30),
    },
  };
}

/** How many people used a feature, and how many came back to it on another day ("repeat users"). */
export function usageStats(uses: { user: string; at: string }[]): { users: number; repeatUsers: number; repeatRate: number } {
  const days = new Map<string, Set<string>>();
  for (const u of uses) {
    if (!u.user) continue;
    const set = days.get(u.user) ?? new Set<string>();
    set.add(u.at.slice(0, 10));
    days.set(u.user, set);
  }
  const repeatUsers = [...days.values()].filter((d) => d.size >= 2).length;
  return { users: days.size, repeatUsers, repeatRate: days.size ? repeatUsers / days.size : 0 };
}
