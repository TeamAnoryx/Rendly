'use client';

import { useEffect, useRef } from 'react';

export const ONGOING_TAG = 'rendly-ongoing';

export interface OngoingNotice {
  title: string;
  body: string;
  /**
   * App path of the room, without the base path (e.g. "/dashboard/huddles/abc"). The service
   * worker resolves it against its scope (see public/sw.js appUrl), which adds the base path.
   */
  path: string;
}

/** The room path with `resume=1` added, so tapping the notification resumes the session. */
export function resumeUrl(path: string): string {
  const [base, hash = ''] = path.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}resume=1${hash ? `#${hash}` : ''}`;
}

/** Service-worker notifications are usable without asking: supported and already granted. */
export function canNotify(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  return 'serviceWorker' in navigator && !!navigator.serviceWorker;
}

type Registration = {
  showNotification: (title: string, opts: NotificationOptions) => Promise<void>;
  getNotifications?: (filter?: { tag?: string }) => Promise<Array<{ close: () => void }>>;
};

async function registration(): Promise<Registration | null> {
  try {
    // getRegistration() settles even when no worker is installed; `ready` would wait forever.
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ? (reg as unknown as Registration) : null;
  } catch {
    return null;
  }
}

export async function showOngoingNotification(notice: OngoingNotice): Promise<boolean> {
  if (!canNotify()) return false;
  const reg = await registration();
  if (!reg) return false;
  try {
    await reg.showNotification(notice.title, {
      tag: ONGOING_TAG,
      body: notice.body,
      data: { url: resumeUrl(notice.path) },
    });
    return true;
  } catch {
    return false;
  }
}

export async function closeOngoingNotifications(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return;
  const reg = await registration();
  if (!reg?.getNotifications) return;
  try {
    const list = await reg.getNotifications({ tag: ONGOING_TAG });
    list.forEach((n) => n.close());
  } catch {
    /* nothing to close */
  }
}

/**
 * While a call or huddle is active, leaving the tab (phone lock, app switch) shows a local
 * notification that brings the user back to the room; returning closes it. Never asks for
 * notification permission here: it only works when permission is already granted.
 */
export function useOngoingNotification(notice: OngoingNotice | null, onResume?: () => void): void {
  const ref = useRef(notice);
  ref.current = notice;
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  const active = !!notice;

  // Tapping the notification focuses this tab (see public/sw.js) and posts a resume message.
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) {
      return undefined;
    }
    const sw = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string } | null;
      if (data?.type === 'rendly-ongoing-resume') resumeRef.current?.();
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [active]);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (ref.current) void showOngoingNotification(ref.current);
      } else {
        void closeOngoingNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void closeOngoingNotifications();
    };
  }, [active]);
}
