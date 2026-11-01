'use client';

import { useCallback, useEffect, useState } from 'react';
import { getResolvedApiUrl, getResolvedApiUrlSync } from '@/lib/resolvedApiUrl';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { authFetch } from '@/lib/api';
import { joinHuddle as joinHuddleRequest } from '@/services/huddlesApi';

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

export type HuddleParticipant = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

export type Huddle = {
  id: string;
  topic: string;
  intent?: string;
  timeLeftSeconds: number | null;
  participants: HuddleParticipant[];
  maxParticipants: number | null;
  canJoin: boolean;
};

function formatTimeLeft(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return 'Ended';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} left`;
}

export function useDashboard() {
  const { user } = useCurrentUser();
  const [stats, setStats] = useState<DashboardStats>({
    avgMatchTimeMinutes: 1,
    onlineUsers: 212,
    lookingForMatch: 1400,
  });
  const [huddles, setHuddles] = useState<Huddle[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<DashboardIntent>('Brainstorm');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      let base = getResolvedApiUrlSync();
      if (!base) base = await getResolvedApiUrl();
      const res = await fetch(`${base}/api/dashboard/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats({
          avgMatchTimeMinutes: data.avgMatchTimeMinutes ?? 1,
          onlineUsers: data.onlineUsers ?? 0,
          lookingForMatch: data.lookingForMatch ?? 0,
        });
      }
    } catch {
      // keep current stats
    }
  }, []);

  const fetchHuddles = useCallback(async () => {
    try {
      const res = await authFetch('/api/huddles/active');
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.huddles ?? [];
        setHuddles(
          list.slice(0, 4).map((h: Record<string, unknown>) => ({
            id: String(h.id ?? ''),
            topic: String(h.topic ?? 'Untitled'),
            intent: h.intent as string | undefined,
            timeLeftSeconds: typeof h.timeLeftSeconds === 'number' ? h.timeLeftSeconds : 585,
            participants: Array.isArray(h.participants) ? h.participants : [],
            maxParticipants: (h.maxParticipants as number) ?? null,
            canJoin: Boolean(h.canJoin ?? true),
          }))
        );
        return;
      }
    } catch {
      // fallback mock when auth or network fails
    }
    setHuddles([
      {
        id: '1',
        topic: 'AI & Ethics Debate',
        timeLeftSeconds: 585,
        participants: [
          { id: 'a', username: 'user1', avatar_url: null },
          { id: 'b', username: 'user2', avatar_url: null },
          { id: 'c', username: 'user3', avatar_url: null },
        ],
        maxParticipants: null,
        canJoin: true,
      },
      {
        id: '2',
        topic: 'Startup Burnout Stories',
        timeLeftSeconds: null,
        participants: [],
        maxParticipants: 8,
        canJoin: false,
      },
      {
        id: '3',
        topic: 'Weekend Project Ideas',
        timeLeftSeconds: null,
        participants: [],
        maxParticipants: 32,
        canJoin: false,
      },
    ]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchStats(), fetchHuddles()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchStats, fetchHuddles]);

  const joinHuddle = useCallback(async (huddleId: string) => {
    await joinHuddleRequest(huddleId);
    await fetchHuddles();
  }, [fetchHuddles]);

  return {
    user,
    stats,
    huddles,
    selectedIntent,
    setSelectedIntent,
    loading,
    error,
    formatTimeLeft,
    joinHuddle,
    refetchStats: fetchStats,
    refetchHuddles: fetchHuddles,
  };
}
