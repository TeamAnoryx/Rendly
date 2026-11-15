'use client';

import { useCallback, useEffect, useState } from 'react';
import { getResolvedApiUrl, getResolvedApiUrlSync } from '@/lib/resolvedApiUrl';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { authFetch } from '@/lib/api';
import { joinHuddle as joinHuddleRequest, type JoinHuddleResponse } from '@/services/huddlesApi';
import { mapActiveHuddle, type ActiveHuddle } from '@/lib/huddleActive';

export const DASHBOARD_INTENTS = ['Light chat', 'Brainstorm', 'Motivation', 'Collaborate'] as const;
export type DashboardIntent = (typeof DASHBOARD_INTENTS)[number];

export type DashboardUser = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  role?: string | null;
};

export type DashboardStats = {
  avgMatchTimeMinutes: number;
  onlineUsers: number;
  lookingForMatch: number;
};

export type Huddle = ActiveHuddle & {
  intent?: string;
};

/** A scheduled huddle that has not started yet (shown under "Upcoming"). */
export type UpcomingHuddle = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
  thumbnailUrl: string | null;
  isOwner: boolean;
  rescheduled: boolean;
};

/** How often the dashboard refreshes stats and live huddles. */
export const DASHBOARD_REFRESH_MS = 15_000;

export function useDashboard() {
  const { user } = useCurrentUser();
  // null until the first successful load, so the UI can show a placeholder instead of fake numbers.
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [huddles, setHuddles] = useState<Huddle[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingHuddle[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<DashboardIntent>('Brainstorm');
  const [loading, setLoading] = useState(true);
  /** Last live-huddles load failure, shown by the dashboard; cleared on the next successful load. */
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      let base = getResolvedApiUrlSync();
      if (!base) base = await getResolvedApiUrl();
      const res = await fetch(`${base}/api/dashboard/stats`);
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
      const data = (await res.json()) as Partial<DashboardStats>;
      setStats({
        onlineUsers: Number(data.onlineUsers ?? 0),
        lookingForMatch: Number(data.lookingForMatch ?? 0),
        avgMatchTimeMinutes: Number(data.avgMatchTimeMinutes ?? 0),
      });
    } catch (err) {
      // Keep the last good numbers; the dashboard still works without them.
      console.warn('[dashboard] stats unavailable', err);
    }
  }, []);

  const fetchUpcoming = useCallback(async () => {
    try {
      const res = await authFetch('/api/huddles?category=all');
      if (!res.ok) throw new Error(`Failed to load upcoming huddles (${res.status})`);
      const data = (await res.json()) as { trendy?: Record<string, unknown>[] };
      const now = Date.now();
      const list = (Array.isArray(data?.trendy) ? data.trendy : [])
        .filter((h) => h.is_active === true && !h.cancelled_at && typeof h.scheduled_at === 'string' && Date.parse(h.scheduled_at as string) > now)
        .sort((a, b) => Date.parse(a.scheduled_at as string) - Date.parse(b.scheduled_at as string))
        .slice(0, 4)
        .map((h) => ({
          id: String(h.id),
          title: String(h.title ?? 'Huddle'),
          scheduledAt: h.scheduled_at as string,
          durationMinutes: typeof h.duration_minutes === 'number' ? h.duration_minutes : null,
          thumbnailUrl: typeof h.thumbnail_url === 'string' ? h.thumbnail_url : null,
          isOwner: h.is_owner === true,
          rescheduled: typeof h.rescheduled_at === 'string',
        }));
      setUpcoming(list);
    } catch (err) {
      // Upcoming is a secondary list; keep the last good one.
      console.warn('[dashboard] upcoming huddles unavailable', err);
    }
  }, []);

  const fetchHuddles = useCallback(async () => {
    void fetchUpcoming();
    try {
      const res = await authFetch('/api/huddles/active');
      if (!res.ok) throw new Error(`Failed to load live huddles (${res.status})`);
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? data : [];
      const now = Date.now();
      setHuddles(
        list
          .slice(0, 4)
          .map((h) => mapActiveHuddle(h as Record<string, unknown>, now))
      );
      setError(null);
    } catch (err) {
      // Surface the failure to the UI; keep the last good list so a blip does not blank the panel.
      setError(err instanceof Error ? err.message : 'Failed to load live huddles');
    }
  }, [fetchUpcoming]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchStats(), fetchHuddles()]);
      if (!cancelled) setLoading(false);
    })();
    // Keep the numbers live: refresh on an interval and when the tab becomes visible again.
    const timer = setInterval(() => {
      fetchStats();
      fetchHuddles();
    }, DASHBOARD_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchStats();
        fetchHuddles();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchStats, fetchHuddles]);

  /** Join (or request to join) a live huddle; resolves to the server's join status. */
  const joinHuddle = useCallback(
    async (huddleId: string): Promise<JoinHuddleResponse> => {
      const result = await joinHuddleRequest(huddleId);
      await fetchHuddles();
      return result;
    },
    [fetchHuddles]
  );

  return {
    user,
    stats,
    huddles,
    upcoming,
    selectedIntent,
    setSelectedIntent,
    loading,
    error,
    joinHuddle,
    refetchStats: fetchStats,
    refetchHuddles: fetchHuddles,
  };
}
