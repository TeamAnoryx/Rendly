'use client';

import React, { useEffect, useState } from 'react';
import { getLeaderboard, getMyPoints, pointsReasonLabel, type LeaderboardRow, type PointsSummary } from '@/services/pointsApi';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';

/** Points balance, rank, recent history and the leaderboard. Used on the profile (#rankings). */
export default function PointsCard() {
  const { user } = useCurrentUser();
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'history' | 'ranks'>('ranks');

  useEffect(() => {
    let alive = true;
    Promise.all([getMyPoints(), getLeaderboard()])
      .then(([s, l]) => {
        if (!alive) return;
        setSummary(s);
        setLeaders(l);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load points'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#rankings') {
      document.getElementById('rankings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [summary]);

  return (
    <section id="rankings" className="pts rd-card">
      <header className="pts-head">
        <div>
          <span className="rd-small rd-muted">Your points</span>
          <div className="pts-total">
            <Icon name="star" size={20} />
            {summary ? summary.total.toLocaleString('en-IN') : '—'}
          </div>
        </div>
        <div className="pts-rank">
          <Icon name="trophy" size={18} />
          <span>{summary?.rank ? `#${summary.rank}` : 'Unranked'}</span>
        </div>
      </header>
      <p className="rd-small rd-muted">
        Earn points in huddles with rewards on: hosts give them for quizzes, competitions and great answers. Everyone starts with 500.
      </p>
      <div className="pts-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'ranks'} className={tab === 'ranks' ? 'pts-tab--on' : ''} onClick={() => setTab('ranks')}>
          Leaderboard
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'pts-tab--on' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </div>
      {error ? <p className="hl-err rd-small">{error}</p> : null}
      {tab === 'ranks' ? (
        <ol className="pts-list">
          {leaders === null && !error ? (
            [0, 1, 2].map((i) => <li key={i} className="rd-skeleton" style={{ height: 34 }} />)
          ) : leaders && leaders.length === 0 ? (
            <li className="rd-small rd-muted">No rankings yet.</li>
          ) : (
            (leaders ?? []).slice(0, 10).map((r) => (
              <li key={r.user_id} className={r.user_id === user?.id ? 'pts-me' : ''}>
                <span className={`pts-pos ${r.rank <= 3 ? `pts-pos--${r.rank}` : ''}`}>{r.rank}</span>
                <Avatar url={r.avatar_url} name={r.username} size="sm" />
                <span className="pts-name">@{r.username ?? 'someone'}</span>
                <strong>{r.total.toLocaleString('en-IN')}</strong>
              </li>
            ))
          )}
        </ol>
      ) : (
        <ul className="pts-list">
          {summary === null && !error ? (
            [0, 1].map((i) => <li key={i} className="rd-skeleton" style={{ height: 34 }} />)
          ) : summary && summary.history.length === 0 ? (
            <li className="rd-small rd-muted">No points yet.</li>
          ) : (
            (summary?.history ?? []).map((h, i) => (
              <li key={`${h.created_at}_${i}`}>
                <span className="pts-name">
                  {pointsReasonLabel(h.reason)}
                  {h.note ? <span className="rd-small rd-muted"> · {h.note}</span> : null}
                </span>
                <span className="rd-small rd-muted">{new Date(h.created_at).toLocaleDateString()}</span>
                <strong className={h.amount >= 0 ? 'pts-plus' : 'pts-minus'}>
                  {h.amount >= 0 ? '+' : ''}
                  {h.amount}
                </strong>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
