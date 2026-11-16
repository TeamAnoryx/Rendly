import { getResolvedApiUrl, getResolvedApiUrlSync, clearResolvedApiUrlCache } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken, clearAuthStorage } from '@/lib/auth-storage';
import { withBasePath } from '@/lib/basePath';

const AUTH_FETCH_TIMEOUT_MS = 45000;

/**
 * Single auth fetch helper: token (sync) + base URL (sync when cached, else await once) + 401 handling.
 * Uses timeout so we never hang; clears API URL cache on network failure so next request rediscoveres.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredAuthToken();
  if (!token) throw new Error('Not authenticated');

  let base = getResolvedApiUrlSync();
  if (!base) base = await getResolvedApiUrl();

  const controller = new AbortController();
  const timeoutId = options.signal ? null : setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
  const signal = options.signal ?? controller.signal;

  try {
    const res = await fetch(`${base}${path}`, {
      ...options,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string>),
      },
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (res.status === 401) {
      clearAuthStorage();
      clearResolvedApiUrlCache();
      if (typeof window !== 'undefined') window.location.href = withBasePath('/login');
      throw new Error('Unauthorized');
    }

    return res;
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e instanceof Error && (e.name === 'AbortError' || e.message?.includes('fetch') || e.message === 'Failed to fetch')) {
      clearResolvedApiUrlCache();
    }
    throw e;
  }
}
