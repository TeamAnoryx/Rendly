'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  getLeaderboard,
  getMyPoints,
  getPointsHistory,
  POINTS_CHANGED_EVENT,
  tokenEntryLabel,
  type LeaderboardRow,
  type PointsEntry,
  type PointsSummary,
} from '@/services/pointsApi';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { Icon } from '@/components/shell/Icon';
import { TokenAmount, TokenCoin } from '@/components/brand/TokenCoin';
import { Avatar } from '@/components/shell/AppShell';

const LEADERBOARD_TOP = 10;
const HISTORY_PAGE = 20;

function formatWhen(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  return {
    date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}

function entryKey(e: PointsEntry, i: number): string {
  return `${e.transfer_id ?? ''}_${e.created_at}_${e.amount}_${i}`;
}

/** Rendly Tokens balance, rank, paged history and the top-10 leaderboard. Used on the profile (#rankings). */
export default function PointsCard() {
  const { user } = useCurrentUser();
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardRow[] | null>(null);
  const [history, setHistory] = useState<PointsEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'history' | 'ranks'>('ranks');

  const load = useCallback(async () => {
    try {
      const [s, l, h] = await Promise.all([getMyPoints(), getLeaderboard(), getPointsHistory({ limit: HISTORY_PAGE })]);
      setSummary(s);
      setLeaders(l);
      setHistory(h.entries);
      setNextBefore(h.next_before);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Rendly Tokens');
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(POINTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(POINTS_CHANGED_EVENT, onChange);
  }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#rankings') {
      document.getElementById('rankings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [summary]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getPointsHistory({ before: nextBefore, limit: HISTORY_PAGE });
      setHistory((prev) => [...(prev ?? []), ...page.entries]);
      setNextBefore(page.next_before);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more history');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section id="rankings" className="pts rd-card">
      <header className="pts-head">
        <div>
          <span className="rd-small rd-muted">Your Rendly Tokens</span>
          <div className="pts-total">
            <TokenCoin size={22} title="Rendly Tokens" />
            {summary ? summary.total.toLocaleString('en-IN') : '—'}
          </div>
        </div>
        <div className="pts-rank">
          <Icon name="trophy" size={18} />
          <span>{summary?.rank ? `#${summary.rank}` : 'Unranked'}</span>
        </div>
      </header>
      <p className="rd-small rd-muted">
        Rendly Tokens are the app currency: send them in whispers, earn them in huddles with rewards on, and spend them on intents.
        Everyone starts with 500.
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
        <ol className="pts-list" aria-label="Top 10 Rendly Tokens holders">
          {leaders === null && !error ? (
            [0, 1, 2].map((i) => <li key={i} className="rd-skeleton" style={{ height: 34 }} />)
          ) : leaders && leaders.length === 0 ? (
            <li className="rd-small rd-muted">No rankings yet.</li>
          ) : (
            (leaders ?? []).slice(0, LEADERBOARD_TOP).map((r) => (
              <li key={r.user_id} className={`pts-row${r.user_id === user?.id ? ' pts-me' : ''}`}>
                <span className={`pts-pos ${r.rank <= 3 ? `pts-pos--${r.rank}` : ''}`} aria-label={`Rank ${r.rank}`}>
                  {r.rank}
                </span>
                <Avatar url={r.avatar_url} name={r.username} size="sm" />
                <span className="pts-name">
                  @{r.username ?? 'someone'}
                  {r.user_id === user?.id ? <span className="rd-small rd-muted"> · you</span> : null}
                </span>
                <strong className="pts-amount">
                  <TokenCoin size={13} />
                  {r.total.toLocaleString('en-IN')}
                </strong>
              </li>
            ))
          )}
        </ol>
      ) : (
        <>
          <ul className="pts-list pts-list--history" aria-label="Rendly Tokens history">
            {history === null && !error ? (
              [0, 1].map((i) => <li key={i} className="rd-skeleton" style={{ height: 40 }} />)
            ) : history && history.length === 0 ? (
              <li className="rd-small rd-muted">No Rendly Tokens activity yet.</li>
            ) : (
              (history ?? []).map((h, i) => {
                const when = formatWhen(h.created_at);
                const hasWho = !!h.counterparty_username || !!h.counterparty_avatar_url;
                return (
                  <li key={entryKey(h, i)} className="pts-row pts-hist">
                    {hasWho ? (
                      <Avatar url={h.counterparty_avatar_url} name={h.counterparty_username} size="sm" />
                    ) : (
                      <span className="pts-hist-glyph" aria-hidden>
                        <TokenCoin size={14} />
                      </span>
                    )}
                    <span className="pts-hist-text">
                      <span className="pts-name">{tokenEntryLabel(h)}</span>
                      <span className="pts-hist-meta rd-small rd-muted">
                        <time dateTime={h.created_at}>
                          {when.date}
                          {when.time ? ` · ${when.time}` : ''}
                        </time>
                        {h.note ? <span className="pts-hist-note"> · {h.note}</span> : null}
                      </span>
                    </span>
                    <TokenAmount amount={h.amount} signed size={13} className="pts-amount" />
                  </li>
                );
              })
            )}
          </ul>
          {nextBefore ? (
            <button type="button" className="rd-btn rd-btn--sm rd-btn--block pts-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
