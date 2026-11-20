/**
 * First-party analytics for the admin console: page views, time on site (15 s heartbeats while
 * the tab is visible), app opens, sign-ins and sign-ups, sent to auth-service. No cookies and no
 * third parties: a random visitor id in localStorage and a session id in sessionStorage. Browsers
 * with Do Not Track or Global Privacy Control are never tracked.
 */
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';

export type TrackType = 'pageview' | 'heartbeat' | 'app_open' | 'signin' | 'signup';

const VISITOR_KEY = 'rendly_vid';
const SESSION_KEY = 'rendly_sid';
const SESSION_SEEN_KEY = 'rendly_sid_seen';
/** A visit that has been idle this long starts a new session. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function trackingAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  return dnt !== '1' && dnt !== 'yes' && nav.globalPrivacyControl !== true;
}

export function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function stored(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing && /^[a-f0-9]{24}$/.test(existing)) return existing;
    const id = randomId();
    storage.setItem(key, id);
    return id;
  } catch {
    return randomId();
  }
}

/** The session id, rotated after 30 idle minutes. `isNew` is true for the first call of a session. */
export function sessionId(now = Date.now()): { id: string; isNew: boolean } {
  try {
    const seen = Number(sessionStorage.getItem(SESSION_SEEN_KEY) || 0);
    const hadSession = !!sessionStorage.getItem(SESSION_KEY);
    if (hadSession && seen && now - seen > SESSION_IDLE_MS) sessionStorage.removeItem(SESSION_KEY);
    const isNew = !sessionStorage.getItem(SESSION_KEY);
    const id = stored(sessionStorage, SESSION_KEY);
    sessionStorage.setItem(SESSION_SEEN_KEY, String(now));
    return { id, isNew };
  } catch {
    return { id: randomId(), isNew: true };
  }
}

/** Report one event. Never throws and never delays the page. */
export async function track(type: TrackType, path: string, extra: { duration_ms?: number; referrer?: string | null } = {}): Promise<void> {
  if (!trackingAllowed()) return;
  try {
    const base = await getResolvedApiUrl();
    if (!base) return;
    const params = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      type,
      path,
      visitor_id: stored(localStorage, VISITOR_KEY),
      session_id: sessionId().id,
      referrer: extra.referrer ?? null,
      utm_source: params.get('utm_source'),
      duration_ms: extra.duration_ms ?? 0,
    });
    const token = getStoredAuthToken();
    await fetch(`${base}/api/analytics/collect`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body,
    });
  } catch {
    // Analytics is best-effort.
  }
}
