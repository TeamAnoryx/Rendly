'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  acceptInvite,
  getConnectionInvites,
  getConnections,
  rejectInvite,
  sendConnectionInvite,
  type Connection,
  type ConnectionInvite,
} from '@/services/connectionsApi';
import { searchUsers, type SearchUser } from '@/services/profileApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import { buildPeopleRows, type PersonRow } from './peopleRows';
import './people.css';

/** A connection added within this window shows under "Recently added". */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_MAX = 5;
const HIGHLIGHT_MS = 2400;
const CACHE_KEY = 'rendly:connections:v1';

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Last lists seen, so the page paints at once while fresh data loads. */
function readCache(): { connections: Connection[]; invites: ConnectionInvite[] } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { connections?: unknown; invites?: unknown };
    if (!Array.isArray(data.connections) || !Array.isArray(data.invites)) return null;
    return { connections: data.connections as Connection[], invites: data.invites as ConnectionInvite[] };
  } catch {
    return null;
  }
}

function writeCache(connections: Connection[], invites: ConnectionInvite[]): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ connections, invites }));
  } catch {
    /* storage full or blocked: the page still works without the cache */
  }
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
  const [invites, setInvites] = useState<ConnectionInvite[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Each list renders as soon as it arrives; neither waits for the other.
  const load = useCallback(async () => {
    const [c, i] = await Promise.all([
      getConnections().then((list) => {
        setConnections(list);
        return list;
      }),
      getConnectionInvites().then((list) => {
        setInvites(list);
        return list;
      }),
    ]);
    writeCache(c, i);
  }, []);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setConnections(cached.connections);
      setInvites(cached.invites);
    }
    load().catch((err) => {
      setConnections((cur) => cur ?? []);
      setInvites((cur) => cur ?? []);
      setError(err instanceof Error ? err.message : 'Could not load connections');
    });
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, [load]);

  const rows = useMemo(() => (connections ? buildPeopleRows(connections, invites ?? []) : null), [connections, invites]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.userId, r])), [rows]);
  const recent = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    return rows
      .filter((r) => r.status === 'connected' && (justAdded.includes(r.userId) || now - new Date(r.at).getTime() < RECENT_MS))
      .slice(0, RECENT_MAX);
  }, [rows, justAdded]);
  const recentIds = useMemo(() => new Set(recent.map((r) => r.userId)), [recent]);
  const others = useMemo(() => (rows ?? []).filter((r) => !recentIds.has(r.userId)), [rows, recentIds]);
  const receivedCount = rows?.filter((r) => r.status === 'received').length ?? 0;
  const connectedCount = connections?.length ?? 0;

  const flash = useCallback((userId: string) => {
    setHighlight(userId);
    requestAnimationFrame(() => {
      document.getElementById(`ppl-row-${userId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
  }, []);

  const respond = async (invite: ConnectionInvite, accept: boolean) => {
    if (busyId) return;
    setBusyId(invite.id);
    setError(null);
    try {
      const res = accept ? await acceptInvite(invite.id) : await rejectInvite(invite.id);
      if (!res.ok) throw new Error(res.message);
      if (accept) setJustAdded((cur) => [invite.other_user.id, ...cur]);
      await load();
      if (accept) flash(invite.other_user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const search = async () => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < 2 || searching) return;
    setSearching(true);
    setFindMsg(null);
    try {
      const list = await searchUsers(q);
      setResults(list);
      // Someone already in People: take the user straight to their row.
      const known = list.find((u) => byId.has(u.id));
      if (known) flash(known.id);
    } catch {
      setResults([]);
      setFindMsg('Search failed. Try again.');
    } finally {
      setSearching(false);
    }
  };

  const invite = async (u: SearchUser) => {
    if (!u.username || inviting) return;
    setInviting(u.id);
    setFindMsg(null);
    try {
      const res = await sendConnectionInvite(u.username);
      if (!res.ok) {
        setFindMsg(res.message);
        return;
      }
      setFindMsg(`Invite sent to @${u.username}.`);
      await load();
      flash(u.id);
    } catch {
      setFindMsg('Could not send the invite.');
    } finally {
      setInviting(null);
    }
  };

  const renderRow = (r: PersonRow) => {
    const busy = !!r.invite && busyId === r.invite.id;
    const cls = `ppl-row ppl-row--hover${highlight === r.userId ? ' ppl-row--hit' : ''}`;
    const name = <span className="ppl-name">@{r.username ?? 'someone'}</span>;
    if (r.status === 'connected') {
      return (
        <li key={r.userId} id={`ppl-row-${r.userId}`}>
          <Link href="/dashboard/chat" className={cls}>
            <Avatar url={r.avatarUrl} name={r.username} />
            <div className="ppl-main">
              {name}
              <span className="ppl-meta">Connected {shortDate(r.at)}</span>
            </div>
            <span className="ppl-time ppl-time--wide">Message</span>
            <Icon name="chevron-right" size={15} className="ppl-chevron" />
          </Link>
        </li>
      );
    }
    const inv = r.invite;
    return (
      <li key={r.userId} id={`ppl-row-${r.userId}`} className={cls}>
        <Avatar url={r.avatarUrl} name={r.username} />
        <div className="ppl-main">
          {name}
          <span className="ppl-meta">
            {r.status === 'received' ? 'Wants to connect' : 'Invite sent'} · {shortDate(r.at)}
          </span>
        </div>
        <div className="ppl-side">
          {r.status === 'sent' ? (
            <span className="rd-badge ppl-pending">Pending</span>
          ) : inv ? (
            <>
              <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={busy} onClick={() => void respond(inv, false)}>
                Decline
              </button>
              <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={busy} onClick={() => void respond(inv, true)}>
                {busy ? <span className="rd-spinner" /> : 'Accept'}
              </button>
            </>
          ) : null}
        </div>
      </li>
    );
  };

  const statusLabel = (u: SearchUser): string | null => {
    const row = byId.get(u.id);
    if (!row) return null;
    return row.status === 'connected' ? 'Connected' : row.status === 'sent' ? 'Pending' : 'Wants to connect';
  };

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
                  <span className="ppl-num">{connectedCount}</span> {connectedCount === 1 ? 'person' : 'people'}
                  {receivedCount ? (
                    <>
                      {' '}
                      · <span className="ppl-num">{receivedCount}</span> waiting on you
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

        <section className="rd-card ppl-section" aria-labelledby="ppl-find">
          <div className="ppl-section-head">
            <span id="ppl-find">Find people</span>
          </div>
          <form
            className="ppl-find"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label className="ppl-search ppl-search--find">
              <Icon name="search" size={14} />
              <input
                className="rd-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by @username"
                aria-label="Find people by username"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="rd-btn rd-btn--sm" disabled={searching || query.trim().replace(/^@/, '').length < 2}>
              {searching ? <span className="rd-spinner" aria-label="Searching" /> : 'Search'}
            </button>
          </form>
          {findMsg ? (
            <p className="ppl-find-msg" role="status">
              {findMsg}
            </p>
          ) : null}
          {results && results.length === 0 && !searching ? <p className="ppl-find-msg">No one found with that username.</p> : null}
          {results && results.length > 0 ? (
            <ul className="ppl-list ppl-results" aria-label="Search results">
              {results.map((u) => {
                const status = statusLabel(u);
                return (
                  <li key={u.id} className="ppl-row">
                    <Avatar url={u.avatar_url} name={u.username ?? u.id} />
                    <div className="ppl-main">
                      <span className="ppl-name">@{u.username ?? u.id}</span>
                    </div>
                    <div className="ppl-side">
                      {status ? (
                        <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => flash(u.id)}>
                          {status} · Show
                        </button>
                      ) : (
                        <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={inviting === u.id} onClick={() => void invite(u)}>
                          {inviting === u.id ? 'Sending…' : 'Invite'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="rd-card ppl-section" aria-labelledby="ppl-people">
          <div className="ppl-section-head">
            <span id="ppl-people">
              People {rows ? <span className="ppl-count ppl-num">{rows.length}</span> : null}
            </span>
          </div>
          {rows === null ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <div className="shell-empty">
              <span className="shell-empty-icon" aria-hidden>
                <Icon name="people" size={18} />
              </span>
              <p>No connections yet. Find people above or Spark a match.</p>
              <Link href="/dashboard/match" className="rd-btn rd-btn--sm">
                <Icon name="spark" size={14} /> Start a Spark
              </Link>
            </div>
          ) : (
            <>
              {recent.length ? (
                <>
                  <p className="ppl-subhead">Recently added</p>
                  <ul className="ppl-list ppl-list--recent">{recent.map(renderRow)}</ul>
                </>
              ) : null}
              {others.length ? (
                <>
                  {recent.length ? <p className="ppl-subhead">Everyone</p> : null}
                  <ul className="ppl-list">{others.map(renderRow)}</ul>
                </>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
