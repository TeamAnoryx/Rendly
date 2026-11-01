'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppNotification,
  clearAllNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  notificationIcon,
} from '@/services/notificationsApi';
import { planToasts } from '@/lib/notificationDiff';
import { getResolvedApiUrl, getResolvedApiUrlSync } from '@/lib/resolvedApiUrl';

const POLL_MS = 10_000;
const TOAST_MS = 6_000;
const MAX_TOASTS = 4;
/** Prompt to meet new people when more than this many are online, at most once a day. */
const BUSY_THRESHOLD = 10;
const BUSY_PROMPT_KEY = 'rendly_busy_prompt_day';

export type Toast = {
  id: string;
  icon: string;
  title: string;
  body?: string | null;
  href?: string | null;
  actionLabel?: string;
  notificationId?: string;
  durationMs?: number;
};

type NotificationsValue = {
  items: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  pushToast: (t: Omit<Toast, 'id'> & { id?: string }) => void;
  dismissToast: (id: string) => void;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the prompt may repeat, which is harmless */
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlightRef = useRef(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const pushToast = useCallback(
    (t: Omit<Toast, 'id'> & { id?: string }) => {
      const id = t.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setToasts((list) => {
        if (list.some((x) => x.id === id)) return list;
        return [...list, { ...t, id }].slice(-MAX_TOASTS);
      });
      const timer = setTimeout(() => dismissToast(id), t.durationMs ?? TOAST_MS);
      timersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const list = await listNotifications();
      setItems(list);
      setError(null);
      const plan = planToasts(seenRef.current, list);
      if (plan.kind === 'each') {
        for (const n of plan.items) {
          pushToast({
            id: `n_${n.id}`,
            icon: notificationIcon(n.type),
            title: n.title,
            body: n.body,
            href: notificationHref(n),
            notificationId: n.id,
          });
        }
      } else if (plan.kind === 'summary') {
        pushToast({
          id: `summary_${Date.now()}`,
          icon: 'bell',
          title: `You have ${plan.count} unread notifications`,
          body: 'Open the bell to catch up.',
        });
      }
      const seen = seenRef.current ?? new Set<string>();
      for (const n of list) seen.add(n.id);
      seenRef.current = seen;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [pushToast]);

  const checkBusy = useCallback(async () => {
    if (readStorage(BUSY_PROMPT_KEY) === todayKey()) return;
    try {
      let base = getResolvedApiUrlSync();
      if (!base) base = await getResolvedApiUrl();
      const res = await fetch(`${base}/api/dashboard/stats`);
      if (!res.ok) return;
      const data = (await res.json()) as { onlineUsers?: unknown };
      const online = Number(data.onlineUsers ?? 0);
      if (online > BUSY_THRESHOLD) {
        writeStorage(BUSY_PROMPT_KEY, todayKey());
        pushToast({
          id: `busy_${todayKey()}`,
          icon: 'spark',
          title: `${online} people are online right now`,
          body: 'A good moment to meet someone new.',
          href: '/dashboard/match',
          actionLabel: 'Spark now',
          durationMs: 10_000,
        });
      }
    } catch (err) {
      console.warn('[notifications] online check failed', err);
    }
  }, [pushToast]);

  useEffect(() => {
    void refresh();
    void checkBusy();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const busy = setInterval(() => void checkBusy(), 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timers = timersRef.current;
    return () => {
      clearInterval(poll);
      clearInterval(busy);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [refresh, checkBusy]);

  const markRead = useCallback(async (id: string) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await markNotificationRead(id);
    } catch (err) {
      console.warn('[notifications] mark read failed', err);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const before = items;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      setItems(before);
      setError(err instanceof Error ? err.message : 'Could not update notifications');
    }
  }, [items]);

  const clearAll = useCallback(async () => {
    const before = items;
    setItems([]);
    try {
      await clearAllNotifications();
    } catch (err) {
      setItems(before);
      setError(err instanceof Error ? err.message : 'Could not clear notifications');
    }
  }, [items]);

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      unreadCount: items.filter((n) => !n.read).length,
      loading,
      error,
      toasts,
      refresh,
      markRead,
      markAllRead,
      clearAll,
      pushToast,
      dismissToast,
    }),
    [items, loading, error, toasts, refresh, markRead, markAllRead, clearAll, pushToast, dismissToast]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
