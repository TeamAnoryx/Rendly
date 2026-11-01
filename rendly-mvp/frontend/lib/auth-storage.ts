/** Keys used to store OAuth data in localStorage (must match login/callback). */
export const GITHUB_STORAGE_KEY = "rendly_oauth_github";
export const LINKEDIN_STORAGE_KEY = "rendly_oauth_linkedin";

/** Session key: when user already verified GitHub and is now verifying LinkedIn, we link to that user. */
export const LINK_TO_GITHUB_ID_KEY = "rendly_link_to_github_id";

/** JWT from email/username + password login. */
export const RENDLY_SESSION_TOKEN = "rendly_session_token";

/** SessionStorage + localStorage key for cached current user (cleared on logout so dashboard loads fresh after re-login). */
export const RENDLY_CURRENT_USER_CACHE_KEY = "rendly_current_user_cache";

type StoredAuth = { verified?: boolean; user?: unknown; token?: string | null };

/** Returns the active JWT for the current session.
 * Prefer the freshest OAuth provider token (GitHub/LinkedIn) because a stale password session
 * token can survive a callback and cause the dashboard to bounce back to /login.
 */
export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const g = localStorage.getItem(GITHUB_STORAGE_KEY);
    if (g) {
      const d: StoredAuth = JSON.parse(g);
      if (d?.verified && d?.token) return d.token;
    }
    const l = localStorage.getItem(LINKEDIN_STORAGE_KEY);
    if (l) {
      const d: StoredAuth = JSON.parse(l);
      if (d?.verified && d?.token) return d.token;
    }
    const session = localStorage.getItem(RENDLY_SESSION_TOKEN);
    if (session && session.trim()) return session.trim();
  } catch {
    // ignore
  }
  return null;
}

/** Clears all auth-related data from localStorage and sessionStorage (for logout). */
export function clearAuthStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GITHUB_STORAGE_KEY);
    localStorage.removeItem(LINKEDIN_STORAGE_KEY);
    localStorage.removeItem(LINK_TO_GITHUB_ID_KEY);
    localStorage.removeItem(RENDLY_SESSION_TOKEN);
    sessionStorage.removeItem(RENDLY_CURRENT_USER_CACHE_KEY);
    localStorage.removeItem(RENDLY_CURRENT_USER_CACHE_KEY);
  } catch {
    // ignore
  }
}
