'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard, type Huddle } from '@/hooks/useDashboard';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { getLeaderboard, getMyPoints, type LeaderboardRow } from '@/services/pointsApi';
import { useNotifications } from '@/context/NotificationsContext';
import HotHuddles from '@/components/home/HotHuddles';
import DashBackdrop from '@/components/home/dash/DashBackdrop';
import DashHeader, { DashActions } from '@/components/home/dash/DashHeader';
import StatStrip from '@/components/home/dash/StatStrip';
import LivePanel from '@/components/home/dash/LivePanel';
import RankingsPanel from '@/components/home/dash/RankingsPanel';
import './dash-layout.css';

export default function DashboardPage() {
  const router = useRouter();
  const { user, stats, huddles, upcoming, loading, error: huddlesError, joinHuddle, refetchHuddles } = useDashboard();
  const { pushToast } = useNotifications();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [points, setPoints] = useState<{ total: number; rank: number | null } | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardRow[] | null>(null);

  usePresenceHeartbeat(Boolean(user));

  useEffect(() => {
    getMyPoints()
      .then((p) => setPoints({ total: p.total, rank: p.rank }))
      .catch(() => setPoints(null));
    getLeaderboard()
      .then((rows) => setLeaders(rows.slice(0, 10)))
      .catch(() => setLeaders([]));
  }, []);

  const handleJoin = useCallback(
    async (h: Huddle) => {
      if (joiningId) return;
      if (!h.canJoin && !h.isParticipant) return;
      setJoiningId(h.id);
      setJoinError(null);
      try {
        const result = await joinHuddle(h.id);
        if (result.status === 'waiting') {
          pushToast({ icon: 'clock', title: "You're in the waiting room", body: 'The host will let you in shortly.' });
        }
        router.push(`/dashboard/huddles/${encodeURIComponent(h.id)}`);
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : 'Could not join');
        setJoiningId(null);
      }
    },
    [joinHuddle, pushToast, router, joiningId]
  );

  const handleRetry = useCallback(() => {
    refetchHuddles();
  }, [refetchHuddles]);

  const name = user?.username ? `@${user.username}` : 'there';

  return (
    <div className="rd-page dl-page">
      <DashBackdrop />
      <div className="dl-root">
        <DashHeader className="dl-head" name={name} stats={stats} />
        <StatStrip
          className="dl-stats"
          points={points}
          liveCount={huddles.length}
          loading={loading}
          stats={stats}
          actions={<DashActions />}
        />
        <HotHuddles className="dl-hot" />
        <LivePanel
          className="dl-live"
          huddles={huddles}
          upcoming={upcoming}
          loading={loading}
          error={huddlesError}
          joinError={joinError}
          joiningId={joiningId}
          onJoin={handleJoin}
          onRetry={handleRetry}
        />
        <RankingsPanel className="dl-rank" leaders={leaders} meId={user?.id ?? null} />
      </div>
    </div>
  );
}
