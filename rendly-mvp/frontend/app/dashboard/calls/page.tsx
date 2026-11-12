'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { chat, type CallLogListItem } from '@/services/chat';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import '../connections/people.css';

type Filter = 'all' | 'missed';

const MISSED = new Set(['missed', 'rejected', 'cancelled']);

function isMissed(log: CallLogListItem): boolean {
  return MISSED.has((log.status ?? '').toLowerCase());
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${s.toString().padStart(2, '0')}`;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function CallsPage() {
  const [logs, setLogs] = useState<CallLogListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let alive = true;
    chat
      .getCallLogs(100, 0)
      .then((l) => alive && setLogs(l))
      .catch((err) => {
        if (!alive) return;
        setLogs([]);
        setError(err instanceof Error ? err.message : 'Could not load calls');
      });
    return () => {
      alive = false;
    };
  }, []);

  const missedCount = useMemo(() => (logs ?? []).filter(isMissed).length, [logs]);
  const shown = useMemo(() => (logs === null ? null : filter === 'missed' ? logs.filter(isMissed) : logs), [logs, filter]);

  return (
    <div className="rd-page ppl">
      <div className="ppl-inner rd-stagger">
        <header className="ppl-head">
          <div>
            <h1 className="rd-h1">Calls</h1>
            <p className="ppl-sub">
              {logs === null ? (
                'Loading…'
              ) : (
                <>
                  <span className="ppl-num">{logs.length}</span> recent {logs.length === 1 ? 'call' : 'calls'}
                  {missedCount ? (
                    <>
                      {' '}
                      · <span className="ppl-num">{missedCount}</span> missed
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
          <div className="ppl-toolbar" role="radiogroup" aria-label="Filter calls">
            {(['all', 'missed'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                className={`rd-chip ${filter === f ? 'rd-chip--on' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : 'Missed'}
              </button>
            ))}
          </div>
        </header>

        {error ? (
          <p className="ppl-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="rd-card ppl-section" aria-label="Call history">
          {shown === null ? (
            <ul className="ppl-list" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="ppl-row">
                  <div className="rd-skeleton ppl-skel--avatar" />
                  <div className="ppl-main">
                    <div className="rd-skeleton ppl-skel" />
                  </div>
                </li>
              ))}
            </ul>
          ) : shown.length === 0 ? (
            <div className="shell-empty">
              <span className="shell-empty-icon" aria-hidden>
                <Icon name="phone" size={18} />
              </span>
              <p>{filter === 'missed' ? 'No missed calls.' : 'No calls yet. Call a connection from Whispers.'}</p>
              {filter === 'missed' ? (
                <button type="button" className="rd-btn rd-btn--sm" onClick={() => setFilter('all')}>
                  Show all calls
                </button>
              ) : (
                <Link href="/dashboard/chat" className="rd-btn rd-btn--sm">
                  <Icon name="chat" size={14} /> Open Whispers
                </Link>
              )}
            </div>
          ) : (
            <ul className="ppl-list">
              {shown.map((log) => {
                const missed = isMissed(log);
                const who = log.other_user.display_name || (log.other_user.username ? `@${log.other_user.username}` : 'Someone');
                const duration = formatDuration(log.duration_seconds);
                return (
                  <li key={log.id}>
                    <Link href={`/dashboard/chat?conv=${encodeURIComponent(log.conversation_id)}`} className="ppl-row">
                      <Avatar url={log.other_user.avatar_url} name={log.other_user.username} online={log.other_user.is_online} />
                      <div className="ppl-main">
                        <span className="ppl-name">{who}</span>
                        <span className={`ppl-meta ${missed ? 'ppl-meta--danger' : ''}`}>
                          <Icon name={missed ? 'phone-missed' : log.call_type === 'video' ? 'video' : 'phone'} size={13} />
                          {missed ? 'Missed' : log.call_type === 'video' ? 'Video call' : 'Voice call'}
                          {duration ? <span className="ppl-num">· {duration}</span> : null}
                        </span>
                      </div>
                      <time className="ppl-time" dateTime={log.started_at}>
                        {whenLabel(log.started_at)}
                      </time>
                      <Icon name="chevron-right" size={15} className="ppl-chevron" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
