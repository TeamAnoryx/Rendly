import type { AppNotification } from '@/services/notificationsApi';

/** Above this many new unread items at once, show one summary pop-up instead of many. */
export const TOAST_BURST_LIMIT = 3;

export type ToastPlan =
  | { kind: 'none' }
  | { kind: 'each'; items: AppNotification[] }
  | { kind: 'summary'; count: number };

/**
 * Decide which pop-ups to show after a poll. New = unread and not seen in an earlier poll.
 * On the first poll after sign-in (seen is null), unread items left from earlier sessions
 * are summarised, so returning the next day shows "you have N unread" once.
 */
export function planToasts(seen: Set<string> | null, list: AppNotification[]): ToastPlan {
  const unread = list.filter((n) => !n.read);
  if (seen === null) {
    if (unread.length === 0) return { kind: 'none' };
    if (unread.length <= TOAST_BURST_LIMIT) return { kind: 'each', items: unread };
    return { kind: 'summary', count: unread.length };
  }
  const fresh = unread.filter((n) => !seen.has(n.id));
  if (fresh.length === 0) return { kind: 'none' };
  if (fresh.length <= TOAST_BURST_LIMIT) return { kind: 'each', items: fresh };
  return { kind: 'summary', count: fresh.length };
}
