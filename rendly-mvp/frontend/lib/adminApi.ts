/**
 * Admin console API client. The admin session token lives in sessionStorage only (gone when the
 * tab closes) and is separate from the user's Rendly session.
 */
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';

const TOKEN_KEY = 'rendly_admin_token';

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the admin has to sign in again.
  }
}

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await getResolvedApiUrl();
  const token = getAdminToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (res.status === 401) {
    setAdminToken(null);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('rendly-admin-signed-out'));
  }
  if (!res.ok) throw new AdminApiError(body?.message || `Request failed (${res.status})`, res.status);
  return body as T;
}

export async function adminLogin(email: string, password: string): Promise<void> {
  const { token } = await adminFetch<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAdminToken(token);
}

export type Counted = { key: string; count: number };
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
export type Overview = {
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
  liveVisitors?: number;
  truncated?: boolean;
};
export type Usage = { users: number; repeatUsers: number; repeatRate: number };
export type Features = {
  totalUsers: number | null;
  newUsers: number | null;
  whispers: { messages: number } & Usage;
  groups: { messages: number | null };
  huddles: { created: number; liveNow: number | null } & Usage;
  spark: { searches: number; matched: number } & Usage;
};
export type Query = {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  subject: string | null;
  category: string | null;
  source: string | null;
  message: string;
  status: 'open' | 'answered' | 'closed';
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};
export type QueryCounts = Record<string, number | null>;
export type SecurityEvent = { created_at: string; kind: string; severity: 'info' | 'warning' | 'critical'; detail: string; path: string | null; alerted: boolean };
export type Security = { events: SecurityEvent[]; bySeverity: { info: number; warning: number; critical: number }; byKind: Counted[] | { kind: string; count: number }[] };
export type Health = {
  services: { name: string; ok: boolean; latencyMs: number; detail: string }[];
  requests: { requests: number; errors5xx: number; authFailures: number; rateLimited: number; avgLatencyMs: number; p95LatencyMs: number; since: string };
  checkedAt: string;
  security: Security;
};
export type Report = {
  kind: 'month' | 'quarter';
  label: string;
  from: string;
  to: string;
  generatedAt: string;
  dashboard: Overview;
  features: Features;
  queries: QueryCounts;
  security: Security;
  health: Omit<Health, 'security'>;
};

export type RangeName = 'day' | 'week' | 'month' | 'quarter';
export const tz = (): number => new Date().getTimezoneOffset();
