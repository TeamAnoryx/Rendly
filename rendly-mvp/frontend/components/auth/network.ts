export const NETWORK_ERROR_MESSAGE = 'No internet connection. Check your network and try again.';

/** True when a fetch failed before reaching the server (offline, DNS, CORS, refused). */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && (err.message === 'Failed to fetch' || err.message?.includes('fetch'))) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
  }
  return false;
}

export const SERVER_UNREACHABLE_MESSAGE = "We couldn't reach Rendly right now. Please try again in a moment.";

/** Message for a failed request: offline only when the browser says so, otherwise the server is unreachable. */
export function networkErrorMessage(): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return NETWORK_ERROR_MESSAGE;
  return SERVER_UNREACHABLE_MESSAGE;
}
