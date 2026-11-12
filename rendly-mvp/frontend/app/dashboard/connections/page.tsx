'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  acceptInvite,
  getConnectionInvites,
  getConnections,
  rejectInvite,
  type Connection,
  type ConnectionInvite,
} from '@/services/connectionsApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import './people.css';

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <ul className="ppl-list" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="ppl-row">
          <div className="rd-skeleton ppl-skel--avatar" />
          <div className="ppl-main">
            <div className="rd-skeleton ppl-skel" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [invites, setInvites] = useState<ConnectionInvite[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([getConnections(), getConnectionInvites()]);
    setConnections(c);
    setInvites(i.filter((x) => x.status === 'pending'));
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setConnections([]);
      setError(err instanceof Error ? err.message : 'Could not load connections');
    });
  }, [load]);

  const respond = async (invite: ConnectionInvite, accept: boolean) => {
    if (busyId) return;
    setBusyId(invite.id);
    setError(null);
    try {
      const res = accept ? await acceptInvite(invite.id) : await rejectInvite(invite.id);
      if (!res.ok) throw new Error(res.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const received = invites.filter((i) => i.direction === 'received');
  const sent = invites.filter((i) => i.direction === 'sent');
  const filtered = useMemo(() => {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!connections) return null;
    return q ? connections.filter((c) => (c.username ?? '').toLowerCase().includes(q)) : connections;
  }, [connections, query]);

  return (
    <div className="rd-page ppl">
      <div className="ppl-inner rd-stagger">
        <header className="ppl-head">
          <div>
            <h1 className="rd-h1">Connections</h1>
            <p className="ppl-sub">
              {connections === null ? (
                'Loading…'
              ) : (
                <>
                  <span className="ppl-num">{connections.length}</span> {connections.length === 1 ? 'person' : 'people'}
                  {received.length ? (
                    <>
                      {' '}
                      · <span className="ppl-num">{received.length}</span> waiting on you
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
          <Link href="/dashboard/match" className="rd-btn rd-btn--primary">
            <Icon name="spark" size={15} /> Meet someone new
          </Link>
        </header>

        {error ? (
          <p className="ppl-error" role="alert">
            {error}
          </p>
        ) : null}

        {received.length ? (
          <section className="rd-card ppl-section" aria-labelledby="ppl-requests">
            <div className="ppl-section-head" id="ppl-requests">
              <span>
                Requests <span className="ppl-count ppl-num">{received.length}</span>
              </span>
            </div>
            <ul className="ppl-list">
              {received.map((inv) => {
                const busy = busyId === inv.id;
                return (
                  <li key={inv.id} className="ppl-row ppl-row--hover">
                    <Avatar url={inv.other_user.avatar_url} name={inv.other_user.username} />
                    <div className="ppl-main">
                      <span className="ppl-name">@{inv.other_user.username ?? 'someone'}</span>
                      <span className="ppl-meta">Wants to connect · {shortDate(inv.created_at)}</span>
                    </div>
                    <div className="ppl-side">
                      <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={busy} onClick={() => void respond(inv, false)}>
                        Decline
                      </button>
                      <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={busy} onClick={() => void respond(inv, true)}>
                        {busy ? <span className="rd-spinner" /> : 'Accept'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="rd-card ppl-section" aria-labelledby="ppl-people">
          <div className="ppl-section-head">
            <span id="ppl-people">
              People {connections ? <span className="ppl-count ppl-num">{connections.length}</span> : null}
            </span>
            {connections && connections.length > 4 ? (
              <label className="ppl-search">
                <Icon name="search" size={14} />
                <input
                  className="rd-input"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search connections"
                />
              </label>
            ) : null}
          </div>
          {filtered === null ? (
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <div className="shell-empty">
              <span className="shell-empty-icon" aria-hidden>
                <Icon name={query ? 'search' : 'people'} size={18} />
              </span>
              <p>{query ? 'No one matches that name.' : 'No connections yet. Spark a match to meet someone.'}</p>
              {query ? (
                <button type="button" className="rd-btn rd-btn--sm" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : (
                <Link href="/dashboard/match" className="rd-btn rd-btn--sm">
                  <Icon name="spark" size={14} /> Start a Spark
                </Link>
              )}
            </div>
          ) : (
            <ul className="ppl-list">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link href="/dashboard/chat" className="ppl-row">
                    <Avatar url={c.avatar_url} name={c.username} />
                    <div className="ppl-main">
                      <span className="ppl-name">@{c.username ?? 'someone'}</span>
                      <span className="ppl-meta">Connected {shortDate(c.connected_at)}</span>
                    </div>
                    <span className="ppl-time ppl-time--wide">Message</span>
                    <Icon name="chevron-right" size={15} className="ppl-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sent.length ? (
          <section className="rd-card ppl-section" aria-labelledby="ppl-sent">
            <div className="ppl-section-head" id="ppl-sent">
              <span>
                Sent <span className="ppl-count ppl-num">{sent.length}</span>
              </span>
            </div>
            <ul className="ppl-list">
              {sent.map((inv) => (
                <li key={inv.id} className="ppl-row">
                  <Avatar url={inv.other_user.avatar_url} name={inv.other_user.username} />
                  <div className="ppl-main">
                    <span className="ppl-name">@{inv.other_user.username ?? 'someone'}</span>
                    <span className="ppl-meta">Sent {shortDate(inv.created_at)}</span>
                  </div>
                  <span className="rd-badge">Pending</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
