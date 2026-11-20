import {
  buildDashboard,
  classifyUserAgent,
  cleanReferrer,
  geoFromHeaders,
  parseCollectInput,
  periodFor,
  reportPeriod,
  summarise,
  usageStats,
  type AnalyticsEvent,
} from "./analytics-rules";

const VISITOR = "visitor_aaaaaaaa";
const SESSION = "session_aaaaaaaa";

function ev(partial: Partial<AnalyticsEvent>): AnalyticsEvent {
  return {
    created_at: "2026-11-20T10:00:00.000Z",
    type: "pageview",
    visitor_id: VISITOR,
    session_id: SESSION,
    user_id: null,
    path: "/",
    referrer: null,
    duration_ms: 0,
    country: "IN",
    city: "Hyderabad",
    lat: 17.4,
    lon: 78.5,
    device: "desktop",
    browser: "Chrome",
    os: "Windows",
    ...partial,
  };
}

describe("parseCollectInput", () => {
  it("accepts a page view and strips the query string", () => {
    const out = parseCollectInput({ type: "pageview", visitor_id: VISITOR, session_id: SESSION, path: "/about?x=1#top" });
    expect(out).toMatchObject({ type: "pageview", path: "/about", duration_ms: 0 });
  });

  it("rejects unknown types and malformed ids", () => {
    expect(parseCollectInput({ type: "click", visitor_id: VISITOR, session_id: SESSION })).toBeNull();
    expect(parseCollectInput({ type: "pageview", visitor_id: "x", session_id: SESSION })).toBeNull();
    expect(parseCollectInput({ type: "pageview", visitor_id: "<script>alert(1)</script>", session_id: SESSION })).toBeNull();
    expect(parseCollectInput(null)).toBeNull();
  });

  it("caps heartbeat duration and ignores duration on other events", () => {
    expect(parseCollectInput({ type: "heartbeat", visitor_id: VISITOR, session_id: SESSION, duration_ms: 9_999_999 })?.duration_ms).toBe(60_000);
    expect(parseCollectInput({ type: "heartbeat", visitor_id: VISITOR, session_id: SESSION, duration_ms: -5 })?.duration_ms).toBe(0);
    expect(parseCollectInput({ type: "pageview", visitor_id: VISITOR, session_id: SESSION, duration_ms: 5000 })?.duration_ms).toBe(0);
  });
});

describe("cleanReferrer", () => {
  it("keeps only the host", () => {
    expect(cleanReferrer("https://www.google.com/search?q=private")).toBe("google.com");
    expect(cleanReferrer("not a url")).toBeNull();
    expect(cleanReferrer(undefined)).toBeNull();
  });
});

describe("classifyUserAgent", () => {
  it("detects mobile Safari on iOS", () => {
    expect(
      classifyUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")
    ).toEqual({ device: "mobile", browser: "Safari", os: "iOS" });
  });

  it("detects desktop Edge on Windows and bots", () => {
    expect(classifyUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0")).toEqual({
      device: "desktop",
      browser: "Edge",
      os: "Windows",
    });
    expect(classifyUserAgent("Googlebot/2.1").device).toBe("bot");
  });
});

describe("geoFromHeaders", () => {
  it("reads Vercel headers and rounds the location", () => {
    expect(
      geoFromHeaders({ "x-vercel-ip-country": "in", "x-vercel-ip-city": "New%20Delhi", "x-vercel-ip-latitude": "28.6139", "x-vercel-ip-longitude": "77.209" })
    ).toEqual({ country: "IN", city: "New Delhi", lat: 28.6, lon: 77.2 });
  });

  it("falls back to Cloudflare and ignores unknown country codes", () => {
    expect(geoFromHeaders({ "cf-ipcountry": "XX" }).country).toBeNull();
    expect(geoFromHeaders({ "cf-ipcountry": "US" }).country).toBe("US");
    expect(geoFromHeaders({})).toEqual({ country: null, city: null, lat: null, lon: null });
  });
});

describe("periods", () => {
  it("defaults to a week and uses hourly buckets for a day", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(periodFor("nonsense", now).name).toBe("week");
    const day = periodFor("day", now);
    expect(day.bucket).toBe("hour");
    expect(now.getTime() - day.from.getTime()).toBe(86_400_000);
  });

  it("builds calendar months and quarters", () => {
    const month = reportPeriod("month", 2026, 10);
    expect(month.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(month.to.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(month.label).toBe("November 2026");
    const q = reportPeriod("quarter", 2026, 3);
    expect(q.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(q.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(q.label).toBe("Q4 2026");
  });
});

describe("summarise", () => {
  it("counts visitors, sessions, watch time, bounces and returning visitors", () => {
    const s = summarise([
      ev({}),
      ev({ type: "heartbeat", duration_ms: 15_000 }),
      ev({ type: "pageview", path: "/about" }),
      ev({ visitor_id: "visitor_bbbbbbbb", session_id: "session_bbbbbbbb" }),
      ev({ visitor_id: "visitor_bbbbbbbb", session_id: "session_cccccccc", created_at: "2026-11-21T10:00:00.000Z" }),
      ev({ type: "signin", user_id: "u1" }),
    ]);
    expect(s.visitors).toBe(2);
    expect(s.sessions).toBe(3);
    expect(s.pageviews).toBe(4);
    expect(s.watchTimeMs).toBe(15_000);
    expect(s.signins).toBe(1);
    expect(s.activeUsers).toBe(1);
    expect(s.bounceRate).toBeCloseTo(2 / 3);
    expect(s.returningRate).toBe(0.5);
  });

  it("is all zeroes for no events", () => {
    expect(summarise([])).toMatchObject({ visitors: 0, bounceRate: 0, avgSessionMs: 0 });
  });
});

describe("buildDashboard", () => {
  const period = periodFor("week", new Date("2026-11-20T23:00:00Z"));

  it("finds peak hour, top pages and geography, ignoring bots", () => {
    const events = [
      ev({ created_at: "2026-11-20T18:05:00Z" }),
      ev({ created_at: "2026-11-20T18:10:00Z", visitor_id: "visitor_bbbbbbbb", session_id: "session_bbbbbbbb", country: "US", city: "Austin" }),
      ev({ created_at: "2026-11-19T03:00:00Z", visitor_id: "visitor_cccccccc", session_id: "session_cccccccc", path: "/about" }),
      ev({ created_at: "2026-11-20T18:15:00Z", visitor_id: "visitor_bot00000", session_id: "session_bot00000", device: "bot" }),
    ];
    const d = buildDashboard(events, [], events, period);
    expect(d.summary.visitors).toBe(3);
    expect(d.peak.hour).toBe(18);
    expect(d.peak.day).toBe("2026-11-20 (Friday)");
    expect(d.pages[0]).toMatchObject({ path: "/", views: 2 });
    expect(d.countries[0]).toEqual({ key: "IN", count: 2 });
    expect(d.cities.map((c) => c.key)).toEqual(expect.arrayContaining(["Hyderabad", "Austin"]));
    expect(d.series.length).toBeGreaterThanOrEqual(7);
  });

  it("shifts hours by the admin's time zone", () => {
    const d = buildDashboard([ev({ created_at: "2026-11-20T18:00:00Z" })], [], [], period, 330);
    expect(d.peak.hour).toBe(23);
  });

  it("counts daily, weekly and monthly active users", () => {
    const now = period.to;
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000 + 60_000).toISOString();
    const month = [ev({ user_id: "a", created_at: ago(0.5) }), ev({ user_id: "b", created_at: ago(5) }), ev({ user_id: "c", created_at: ago(20) })];
    expect(buildDashboard([], [], month, period).activeUsers).toEqual({ daily: 1, weekly: 2, monthly: 3 });
  });
});

describe("usageStats", () => {
  it("counts users and those who came back on another day", () => {
    const s = usageStats([
      { user: "a", at: "2026-11-01T10:00:00Z" },
      { user: "a", at: "2026-11-01T11:00:00Z" },
      { user: "b", at: "2026-11-01T10:00:00Z" },
      { user: "b", at: "2026-11-03T10:00:00Z" },
      { user: "", at: "2026-11-03T10:00:00Z" },
    ]);
    expect(s).toEqual({ users: 2, repeatUsers: 1, repeatRate: 0.5 });
    expect(usageStats([])).toEqual({ users: 0, repeatUsers: 0, repeatRate: 0 });
  });
});
