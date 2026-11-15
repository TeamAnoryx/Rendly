'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { HuddleListItem } from '@/services/huddlesApi';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { HuddlePoster } from '@/components/huddles/HuddleList';
import { Icon } from '@/components/shell/Icon';
import './huddle-board.css';

type Tab = 'discover' | 'live' | 'upcoming' | 'mine';

const TABS: { id: Tab; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'mine', label: 'Mine' },
];

const EMPTY: Record<Tab, string> = {
  discover: 'No public huddles match yet.',
  live: 'Nothing is live right now.',
  upcoming: 'Nothing scheduled yet.',
  mine: "You haven't hosted a huddle yet.",
};

/** Row height plus gap (px); used to work out how many rows fit without scrolling. */
const ROW_PX = 66;
const TWO_COL_MIN_W = 820;

function slotEnd(h: HuddleListItem): number {
  if (!h.scheduled_at || !h.duration_minutes) return Number.POSITIVE_INFINITY;
  return Date.parse(h.scheduled_at) + h.duration_minutes * 60_000;
}

function startLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

interface BoardRowProps {
  h: HuddleListItem;
  live: boolean;
  index: number;
}

function BoardRow({ h, live, index }: BoardRowProps) {
  const full = h.participants_count >= h.max_participants;
  const status = live ? 'Live' : h.scheduled_at ? startLabel(h.scheduled_at) : 'Open';
  const cta = live ? (full ? 'Full' : 'Join') : 'View';
  return (
    <li className="hb-row-wrap" style={{ animationDelay: `${index * 35}ms` }}>
      <Link href={`/dashboard/huddles/${encodeURIComponent(h.id)}`} className={`hb-row ${live ? 'hb-row--live' : ''}`} aria-label={`${h.title}, ${status}`}>
        <span className="hb-thumb" aria-hidden>
          <HuddlePoster huddle={h} />
        </span>
        <span className="hb-main">
          <span className="hb-title-line">
            <span className="hb-title">{h.title}</span>
            {h.is_owner ? <span className="hb-chip">Yours</span> : null}
            {h.mode && h.mode !== 'open' ? <span className="hb-chip">{HUDDLE_MODE_LABELS[h.mode]}</span> : null}
            {h.type === 'private' ? (
              <span className="hb-chip">
                <Icon name="lock" size={9} />
              </span>
            ) : null}
          </span>
          <span className="hb-meta">
            <span className={`hb-status ${live ? 'hb-status--live' : ''}`}>
              {live ? <span className="hb-dot" /> : <Icon name="clock" size={11} />}
              {status}
            </span>
            {!live && h.rescheduled_at ? <span className="hb-moved">Rescheduled</span> : null}
            <span className="hb-seats">
              <Icon name="people" size={11} /> {h.participants_count}/{h.max_participants}
            </span>
            {h.intents?.slice(0, 2).map((t) => (
              <span key={t} className="hb-tag">
                #{t}
              </span>
            ))}
          </span>
        </span>
        <span className={`hb-cta ${live && !full ? 'hb-cta--on' : ''}`}>
          {cta} <Icon name="arrow-right" size={12} />
        </span>
      </Link>
    </li>
  );
}

export interface HuddleBoardProps {
  trendy: HuddleListItem[];
  live: HuddleListItem[];
  loading: boolean;
  error: string | null;
  intent: string | null;
  onCreate: () => void;
  className?: string;
}

export default function HuddleBoard({ trendy, live, loading, error, intent, onCreate, className }: HuddleBoardProps) {
  const [tab, setTab] = useState<Tab>('discover');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(6);
  const [cols, setCols] = useState(1);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Fit the page size to the space the board has, so it never scrolls.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const c = el.clientWidth >= TWO_COL_MIN_W ? 2 : 1;
      const rows = Math.max(1, Math.floor((el.clientHeight + 6) / ROW_PX));
      setCols(c);
      setPerPage(rows * c);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const liveIds = useMemo(() => new Set(live.map((h) => h.id)), [live]);
  const lists = useMemo<Record<Tab, HuddleListItem[]>>(() => {
    const now = Date.now();
    const seen = new Set<string>();
    const all = [...live, ...trendy].filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
    const open = all.filter((h) => !h.cancelled_at && (liveIds.has(h.id) || slotEnd(h) > now));
    const upcoming = open
      .filter((h) => !liveIds.has(h.id) && !!h.scheduled_at)
      .sort((a, b) => Date.parse(a.scheduled_at as string) - Date.parse(b.scheduled_at as string));
    const liveList = open.filter((h) => liveIds.has(h.id));
    const rest = open.filter((h) => !liveIds.has(h.id) && !h.scheduled_at);
    return {
      discover: [...liveList, ...upcoming, ...rest],
      live: liveList,
      upcoming,
      mine: all.filter((h) => h.is_owner && !h.cancelled_at),
    };
  }, [trendy, live, liveIds]);

  const items = lists[tab];
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = items.slice(current * perPage, current * perPage + perPage);

  useEffect(() => setPage(0), [tab, intent]);

  return (
    <section className={`hb ${className ?? ''}`} aria-label="Huddles">
      <header className="hb-head">
        <div className="hb-tabs" role="tablist" aria-label="Huddle lists">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`hb-tab ${tab === t.id ? 'hb-tab--on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.id === 'live' ? <span className="hb-dot" aria-hidden /> : null}
              {t.label}
              {!loading ? <span className="hb-count">{lists[t.id].length}</span> : null}
            </button>
          ))}
        </div>
        {pages > 1 ? (
          <div className="hb-pager">
            <span className="hb-pageno">
              {current + 1} / {pages}
            </span>
            <button type="button" className="hb-arrow" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
              <Icon name="back" size={14} />
            </button>
            <button type="button" className="hb-arrow" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="hb-error" role="alert">
          {error}
        </p>
      ) : null}

      <div ref={bodyRef} className="hb-body" role="tabpanel">
        {loading ? (
          <ul className="hb-list" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-busy="true">
            {Array.from({ length: Math.min(perPage, 6) }, (_, i) => (
              <li key={i} className="hb-skel rd-skeleton" />
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <div className="hb-empty">
            <span className="hb-empty-icon" aria-hidden>
              <Icon name="huddle" size={18} />
            </span>
            <p>{intent ? `No huddles for #${intent} here.` : EMPTY[tab]}</p>
            <button type="button" className="rd-btn rd-btn--sm" onClick={onCreate}>
              <Icon name="plus" size={13} /> Host a huddle
            </button>
          </div>
        ) : (
          <ul key={`${tab}-${current}-${intent ?? ''}`} className="hb-list" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {shown.map((h, i) => (
              <BoardRow key={h.id} h={h} live={liveIds.has(h.id)} index={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
