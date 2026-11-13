'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDashboard, type Huddle } from '@/hooks/useDashboard';
import { formatTimeLeft } from '@/lib/huddleActive';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { getLeaderboard, getMyPoints, type LeaderboardRow } from '@/services/pointsApi';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { useNotifications } from '@/context/NotificationsContext';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import HotHuddles from '@/components/home/HotHuddles';
import './home.css';

/** Button copy for a live-huddle row. */
function joinLabel(h: Pick<Huddle, 'canJoin' | 'isParticipant' | 'waitingRoom'>): string {
  if (h.isParticipant) return 'Rejoin';
  if (!h.canJoin) return 'Full';
  if (h.waitingRoom) return 'Request to join';
  return 'Join';
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

interface StatProps {
  icon: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
}

function Stat({ icon, label, value, hint, href }: StatProps) {
  const body = (
    <>
      <span className="home-stat-label">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className="home-stat-value">{value}</span>
      {hint ? <span className="home-stat-hint">{hint}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="home-stat home-stat--link">
      {body}
    </Link>
  ) : (
    <div className="home-stat">{body}</div>
  );
}

const SHORTCUTS: { href: string; icon: string; title: string; hint: string }[] = [
  { href: '/dashboard/chat', icon: 'chat', title: 'Whispers', hint: 'Chat and call your connections' },
  { href: '/dashboard/connections', icon: 'people', title: 'Connections', hint: 'Requests and people you know' },
  { href: '/dashboard/calls', icon: 'phone', title: 'Calls', hint: 'Your recent calls' },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, stats, huddles, loading, error: huddlesError, joinHuddle, refetchHuddles } = useDashboard();
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
      .then((rows) => setLeaders(rows.slice(0, 5)))
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

  const name = user?.username ? `@${user.username}` : 'there';

  return (
    <div className="rd-page home">
      <div className="home-inner rd-stagger">
        <header className="home-head">
          <div className="home-head-copy">
            <h1 className="rd-h1">
              {greeting()}, {name}
            </h1>
            <p className="home-sub">
              {stats ? (
                <>
                  <span className="home-live-dot" aria-hidden />
                  <span className="home-num">{stats.onlineUsers.toLocaleString('en-IN')}</span> online now ·{' '}
                  <span className="home-num">{stats.lookingForMatch.toLocaleString('en-IN')}</span> looking to match
                </>
              ) : (
                'Who will you meet today?'
              )}
            </p>
          </div>
          <div className="home-actions">
            <Link href="/dashboard/huddles?create=1" className="rd-btn">
              <Icon name="plus" size={15} /> Host a huddle
            </Link>
            <Link href="/dashboard/match" className="rd-btn rd-btn--primary">
              <Icon name="spark" size={15} /> Start a Spark
            </Link>
          </div>
        </header>

        <section className="home-stats" aria-label="Overview">
          <Stat
            icon="coin"
            label="Rendly Tokens"
            value={points ? points.total.toLocaleString('en-IN') : '—'}
            hint={points?.rank ? `Rank #${points.rank}` : 'Unranked'}
            href="/dashboard/profile#rankings"
          />
          <Stat
            icon="huddle"
            label="Live huddles"
            value={loading ? '—' : huddles.length}
            hint={huddles.length ? 'Happening now' : 'None right now'}
            href="/dashboard/huddles"
          />
          <Stat
            icon="activity"
            label="Online now"
            value={stats ? stats.onlineUsers.toLocaleString('en-IN') : '—'}
            hint={stats ? `${stats.lookingForMatch} looking to match` : ' '}
          />
          <Stat
            icon="clock"
            label="Avg. match time"
            value={stats ? `~${stats.avgMatchTimeMinutes}m` : '—'}
            hint="To find a Spark"
          />
        </section>

        <div className="home-grid">
          {/* Live huddles */}
          <section className="rd-card home-panel" aria-labelledby="home-huddles-title">
            <header className="home-panel-head">
              <h2 id="home-huddles-title" className="rd-h2">
                Live huddles
                {huddles.length ? <span className="rd-badge rd-badge--live">{huddles.length} live</span> : null}
              </h2>
              <Link href="/dashboard/huddles" className="rd-btn rd-btn--ghost rd-btn--sm">
                See all <Icon name="arrow-right" size={13} className="rd-btn-arrow" />
              </Link>
            </header>
            {joinError ? <p className="rd-small home-error" role="alert">{joinError}</p> : null}
            {huddlesError && !loading ? (
              <p className="rd-small home-error" role="alert">
                {huddlesError}{' '}
                <button type="button" className="home-error-retry" onClick={() => refetchHuddles()}>
                  Retry
                </button>
              </p>
            ) : null}
            <div className="home-list">
              {loading ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="home-row">
                    <div className="rd-skeleton home-skel-tile" />
                    <div className="home-row-main">
                      <div className="rd-skeleton home-skel-line" />
                      <div className="rd-skeleton home-skel-line home-skel-line--short" />
                    </div>
                  </div>
                ))
              ) : huddles.length === 0 ? (
                <div className="shell-empty">
                  <span className="shell-empty-icon" aria-hidden>
                    <Icon name="huddle" size={18} />
                  </span>
                  <p>No live huddles right now.</p>
                  <Link href="/dashboard/huddles?create=1" className="rd-btn rd-btn--sm">
                    <Icon name="plus" size={14} /> Start one
                  </Link>
                </div>
              ) : (
                huddles.map((h) => {
                  const joining = joiningId === h.id;
                  const enabled = (h.canJoin || h.isParticipant) && !joining;
                  const label = joinLabel(h);
                  return (
                    <article key={h.id} className="home-row">
                      {h.thumbnailUrl ? (
                        <span className="home-row-tile home-row-tile--thumb" aria-hidden>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={h.thumbnailUrl} alt="" loading="lazy" />
                        </span>
                      ) : (
                        <span className="home-row-tile" aria-hidden>
                          <Icon name="huddle" size={16} />
                        </span>
                      )}
                      <div className="home-row-main">
                        <h3 className="home-row-title">
                          <span className="home-row-title-text">{h.topic}</span>
                          {h.mode ? <span className="home-row-chip">{HUDDLE_MODE_LABELS[h.mode]}</span> : null}
                          {h.isOwner ? <span className="home-row-chip home-row-chip--you">Yours</span> : null}
                        </h3>
                        <p className="home-row-meta">
                          <span className="home-num">
                            {h.participantsCount}
                            {h.maxParticipants != null ? `/${h.maxParticipants}` : ''}
                          </span>{' '}
                          in the room · <span className="home-num">{formatTimeLeft(h.timeLeftSeconds)}</span>
                          {h.intents.slice(0, 2).map((t) => (
                            <span key={t} className="home-row-tag">
                              #{t}
                            </span>
                          ))}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`rd-btn rd-btn--sm ${enabled && !h.isParticipant ? 'rd-btn--primary' : ''}`}
                        disabled={!enabled}
                        onClick={() => handleJoin(h)}
                      >
                        {joining ? <span className="rd-spinner" /> : label}
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          {/* Rendly Tokens and rankings */}
          <section className="rd-card home-panel" aria-labelledby="home-ranks-title">
            <header className="home-panel-head">
              <h2 id="home-ranks-title" className="rd-h2">
                Rankings
              </h2>
              <Link href="/dashboard/profile#rankings" className="rd-btn rd-btn--ghost rd-btn--sm">
                Details <Icon name="arrow-right" size={13} className="rd-btn-arrow" />
              </Link>
            </header>
            <ol className="home-list home-leaders">
              {leaders === null ? (
                [0, 1, 2].map((i) => (
                  <li key={i} className="home-row">
                    <div className="rd-skeleton home-skel-line" />
                  </li>
                ))
              ) : leaders.length === 0 ? (
                <li className="shell-empty">
                  <span className="shell-empty-icon" aria-hidden>
                    <Icon name="trophy" size={18} />
                  </span>
                  <p>Rankings appear once Rendly Tokens are earned.</p>
                </li>
              ) : (
                leaders.map((r) => (
                  <li key={r.user_id} className={`home-row home-leader ${r.user_id === user?.id ? 'home-leader--me' : ''}`}>
                    <span className="home-leader-rank home-num">{r.rank}</span>
                    <Avatar url={r.avatar_url} name={r.username} size="sm" />
                    <span className="home-leader-name">
                      @{r.username ?? 'someone'}
                      {r.user_id === user?.id ? <span className="home-you">You</span> : null}
                    </span>
                    <span className="home-leader-points home-num">{r.total.toLocaleString('en-IN')}</span>
                  </li>
                ))
              )}
            </ol>
          </section>
        </div>

        {/* Top 5 hot huddles */}
        <HotHuddles />

        {/* Shortcuts */}
        <nav className="rd-card home-shortcuts" aria-label="Shortcuts">
          {SHORTCUTS.map((s) => (
            <Link key={s.href} href={s.href} className="home-shortcut">
              <span className="home-row-tile" aria-hidden>
                <Icon name={s.icon} size={16} />
              </span>
              <span className="home-row-main">
                <span className="home-row-title">{s.title}</span>
                <span className="home-row-meta">{s.hint}</span>
              </span>
              <Icon name="chevron-right" size={15} className="home-shortcut-chevron" />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
