'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDashboard, type Huddle } from '@/hooks/useDashboard';
import { formatTimeLeft } from '@/lib/huddleActive';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { getLeaderboard, getMyPoints, type LeaderboardRow } from '@/services/pointsApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import './home.css';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className={`home-stat ${accent ? 'home-stat--accent' : ''}`}>
      <span className="home-stat-value">{value}</span>
      <span className="home-stat-label">{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, stats, huddles, loading, joinHuddle } = useDashboard();
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
      .then((rows) => setLeaders(rows.slice(0, 5)))
      .catch(() => setLeaders([]));
  }, []);

  const handleJoin = useCallback(
    async (h: Huddle) => {
      if (!h.canJoin || joiningId) return;
      setJoiningId(h.id);
      setJoinError(null);
      try {
        await joinHuddle(h.id);
        router.push(`/dashboard/huddles/${h.id}`);
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : 'Could not join');
        setJoiningId(null);
      }
    },
    [joinHuddle, router, joiningId]
  );

  const name = user?.username ? `@${user.username}` : 'there';

  return (
    <div className="rd-page home">
      {/* Hero: greeting, live numbers and the main call to action. */}
      <section className="rd-card rd-card--glow home-hero rd-stagger">
        <div className="home-hero-copy">
          <p className="rd-muted home-eyebrow">{greeting()}</p>
          <h1 className="rd-h1">
            Hey {name}, <span className="rd-gradient-text">who will you meet today?</span>
          </h1>
          <div className="home-stats">
            <Stat value={stats ? stats.onlineUsers : '—'} label="online now" accent />
            <Stat value={stats ? stats.lookingForMatch : '—'} label="looking to match" />
            <Stat value={stats ? `~${stats.avgMatchTimeMinutes}m` : '—'} label="avg match time" />
          </div>
          <div className="home-hero-actions">
            <Link href="/dashboard/match" className="rd-btn rd-btn--primary rd-btn--lg">
              <Icon name="spark" size={18} /> Spark a match
            </Link>
            <Link href="/dashboard/huddles?create=1" className="rd-btn rd-btn--ghost rd-btn--lg">
              <Icon name="plus" size={18} /> Host a huddle
            </Link>
          </div>
        </div>
        <div className="home-hero-art" aria-hidden>
          <div className="rd-orb home-orb" />
          <span className="home-ring home-ring--1" />
          <span className="home-ring home-ring--2" />
        </div>
      </section>

      <div className="home-grid">
        {/* Live huddles */}
        <section className="rd-card home-huddles">
          <header className="home-section-head">
            <h2 className="rd-h2">
              <span className="rd-badge rd-badge--live">LIVE</span> Huddles
            </h2>
            <Link href="/dashboard/huddles" className="rd-btn rd-btn--ghost rd-btn--sm">
              See all
            </Link>
          </header>
          {joinError ? <p className="rd-small home-error">{joinError}</p> : null}
          <div className="home-huddle-list rd-scroll">
            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className="rd-skeleton home-huddle-skel" />)
            ) : huddles.length === 0 ? (
              <div className="home-empty">
                <Icon name="huddle" size={30} />
                <p>No live huddles right now.</p>
                <Link href="/dashboard/huddles?create=1" className="rd-btn rd-btn--primary rd-btn--sm">
                  Start one
                </Link>
              </div>
            ) : (
              huddles.map((h) => {
                const joining = joiningId === h.id;
                return (
                  <article key={h.id} className="home-huddle rd-tilt">
                    <div className="home-huddle-main">
                      <h3>{h.topic}</h3>
                      <p className="rd-small rd-muted">
                        {formatTimeLeft(h.timeLeftSeconds)} · {h.participantsCount}
                        {h.maxParticipants != null ? `/${h.maxParticipants}` : ''} in the room
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rd-btn rd-btn--primary rd-btn--sm"
                      disabled={!h.canJoin || joining}
                      onClick={() => handleJoin(h)}
                    >
                      {joining ? <span className="rd-spinner" /> : h.canJoin ? 'Join' : 'Full'}
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* Points and rankings */}
        <section className="rd-card home-points">
          <header className="home-section-head">
            <h2 className="rd-h2">
              <Icon name="trophy" size={18} /> Rankings
            </h2>
            <Link href="/dashboard/profile#rankings" className="rd-btn rd-btn--ghost rd-btn--sm">
              Details
            </Link>
          </header>
          <div className="home-points-me">
            <div>
              <span className="home-points-total">{points ? points.total.toLocaleString('en-IN') : '—'}</span>
              <span className="rd-small rd-muted"> points</span>
            </div>
            <span className="rd-chip">{points?.rank ? `Rank #${points.rank}` : 'Unranked'}</span>
          </div>
          <ol className="home-leaders rd-scroll">
            {leaders === null ? (
              [0, 1, 2].map((i) => <li key={i} className="rd-skeleton" style={{ height: 36 }} />)
            ) : leaders.length === 0 ? (
              <li className="rd-small rd-muted">Rankings appear once points are awarded.</li>
            ) : (
              leaders.map((r) => (
                <li key={r.user_id} className={r.user_id === user?.id ? 'home-leader--me' : ''}>
                  <span className="home-leader-rank">{r.rank}</span>
                  <Avatar url={r.avatar_url} name={r.username} size="sm" />
                  <span className="home-leader-name">@{r.username ?? 'someone'}</span>
                  <strong>{r.total.toLocaleString('en-IN')}</strong>
                </li>
              ))
            )}
          </ol>
        </section>

        {/* Quick links */}
        <section className="home-quick">
          <Link href="/dashboard/chat" className="rd-card home-quick-card rd-tilt">
            <Icon name="chat" size={22} />
            <div>
              <strong>Whispers</strong>
              <p className="rd-small rd-muted">Chat and call your connections</p>
            </div>
          </Link>
          <Link href="/dashboard/connections" className="rd-card home-quick-card rd-tilt">
            <Icon name="people" size={22} />
            <div>
              <strong>Connections</strong>
              <p className="rd-small rd-muted">Requests and people you know</p>
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}
