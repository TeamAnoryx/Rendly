/**
 * `?resume=1` marks a room opened from the "ongoing call / huddle" notification.
 * Returns true when the current URL carries it, and strips it (keeping Next's history state).
 */
export function hasResumeParam(search: string): boolean {
  return new URLSearchParams(search).get('resume') === '1';
}

/** The same URL without `resume`. */
export function stripResumeParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('resume');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function consumeResumeParam(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasResumeParam(window.location.search)) return false;
  window.history.replaceState(window.history.state, '', stripResumeParam(window.location.href));
  return true;
}
