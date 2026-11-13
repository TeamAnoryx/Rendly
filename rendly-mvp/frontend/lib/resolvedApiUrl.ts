/**
 * Single permanent backend URL: auto-detect by trying 4001 (local auth) then 80 (Docker gateway).
 * Persists in sessionStorage so refresh doesn't require health-check; cleared on auth failure so we rediscover.
 */

const CANDIDATES = ["http://localhost:4001", "http://localhost:80"] as const;
const HEALTH_PATH = "/health";
const TIMEOUT_MS = 4000;
const STORAGE_KEY_AUTH_API_URL = "rendly_auth_api_url";

let cached: string | null = null;

function getStoredAuthApiUrl(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const url = sessionStorage.getItem(STORAGE_KEY_AUTH_API_URL);
    return url && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

function setStoredAuthApiUrl(url: string | null) {
  try {
    if (typeof sessionStorage !== "undefined") {
      if (url) sessionStorage.setItem(STORAGE_KEY_AUTH_API_URL, url);
      else sessionStorage.removeItem(STORAGE_KEY_AUTH_API_URL);
    }
  } catch {
    // ignore
  }
}

function checkHealth(baseUrl: string): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
  return new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, TIMEOUT_MS);
    fetch(url, { signal: controller.signal })
      .then((res) => {
        clearTimeout(t);
        resolve(res.ok);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(false);
      });
  });
}

/**
 * Resolves the backend API base URL. Uses sessionStorage so refresh doesn't require health-check.
 * Use this everywhere instead of NEXT_PUBLIC_API_URL so one config works for both local and Docker.
 */
export async function getResolvedApiUrl(): Promise<string> {
  if (cached) return cached;

  // Must be the literal `process.env.NEXT_PUBLIC_*` form: Next.js only inlines that exact
  // expression into browser code (optional chaining like `process.env?.X` is left undefined).
  const override = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  if (override) {
    // Configured URL (production): use it directly, no health-probe round trip.
    const base = override.replace(/\/$/, "");
    cached = base;
    setStoredAuthApiUrl(base);
    return cached;
  }

  const stored = getStoredAuthApiUrl();
  if (stored) {
    const ok = await checkHealth(stored);
    if (ok) {
      cached = stored;
      return cached;
    }
    setStoredAuthApiUrl(null);
  }

  for (const base of CANDIDATES) {
    const ok = await checkHealth(base);
    if (ok) {
      cached = base;
      setStoredAuthApiUrl(base);
      return cached;
    }
  }

  cached = CANDIDATES[0];
  setStoredAuthApiUrl(cached);
  return cached;
}

/** Returns the cached URL if already resolved; otherwise stored URL from sessionStorage (so first request can skip health). */
export function getResolvedApiUrlSync(): string | null {
  if (cached) return cached;
  const stored = getStoredAuthApiUrl();
  if (stored) {
    cached = stored;
    return cached;
  }
  return null;
}

/** Clear cached auth API URL so next request will re-run health check (call on network/auth failure). */
export function clearResolvedApiUrlCache(): void {
  cached = null;
  setStoredAuthApiUrl(null);
}

/** WS URL from the same host as the resolved API (for socket.io etc.). */
export function apiUrlToWsUrl(apiUrl: string): string {
  return apiUrl.replace(/^http/, "ws");
}

/** Chat-service REST + Socket.IO. Try 3004 first (common dev port), then 4002. */
const CHAT_CANDIDATES = ["http://localhost:3004", "http://localhost:4002"] as const;
let chatCached: string | null = null;

async function checkChatHealth(baseUrl: string): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return (data as { service?: string })?.service === "chat-service";
  } catch {
    return false;
  }
}

/**
 * Resolves the chat-service API base URL for /api/conversations and /api/conversations/:id/messages.
 * Use in chat.ts so REST hits chat-service (not auth). Cached for the session.
 */
export async function getChatApiUrl(): Promise<string> {
  if (chatCached) return chatCached;

  const override = (process.env.NEXT_PUBLIC_CHAT_API_URL || "").trim();
  if (override) {
    chatCached = override.replace(/\/$/, "");
    return chatCached;
  }

  for (const base of CHAT_CANDIDATES) {
    const ok = await checkChatHealth(base);
    if (ok) {
      chatCached = base;
      return base;
    }
  }

  // Don't cache when all failed so next request retries (e.g. after chat-service starts).
  return CHAT_CANDIDATES[0];
}

/**
 * WebSocket URL for Socket.IO (message:received, typing, etc.).
 * Uses the same host as chat-service so one backend serves both REST and WS.
 */
export async function getCcsWsUrl(): Promise<string> {
  const url = (process.env.NEXT_PUBLIC_CCS_WS_URL || "").trim();
  if (url) {
    const base = url.replace(/\/$/, "");
    return Promise.resolve(base.startsWith("ws") ? base : base.replace(/^http/, "ws"));
  }
  const chatBase = await getChatApiUrl();
  return apiUrlToWsUrl(chatBase);
}
