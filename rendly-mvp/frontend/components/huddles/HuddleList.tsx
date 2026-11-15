'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { HuddleListItem } from '@/services/huddlesApi';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { Icon } from '@/components/shell/Icon';

/** Quiet monochrome gradient seeded from the huddle id, used when there is no poster. */
function seededGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const angle = 100 + (h % 140);
  const a = 14 + (h % 8);
  const b = 6 + ((h >> 3) % 5);
  return `radial-gradient(120% 90% at 20% 0%, hsl(220 6% ${a}%), transparent 60%), linear-gradient(${angle}deg, hsl(220 5% ${b + 4}%), hsl(220 6% ${b}%))`;
}

/**
 * Card art: the host's poster image or 15-second promo (muted, looping, plays when visible),
 * falling back to the older promo media, then to a gradient with the huddle's initial.
 */
export function HuddlePoster({ huddle, large = false }: { huddle: HuddleListItem; large?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const thumbUrl = huddle.thumbnail_url ?? (huddle.media_type === 'image' || huddle.media_type === 'video' ? huddle.media_url : null);
  const isVideo = huddle.thumbnail_url ? huddle.thumbnail_type === 'video' : huddle.media_type === 'video';

  useEffect(() => {
    const el = ref.current;
    if (!el || !isVideo) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [isVideo]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) el.play().catch(() => undefined);
    else el.pause();
  }, [visible]);

  return (
    <div className={`hp ${large ? 'hp--large' : ''}`} style={thumbUrl ? undefined : { background: seededGradient(huddle.id) }}>
      {thumbUrl && isVideo ? <video ref={ref} src={thumbUrl} muted loop playsInline preload="metadata" /> : null}
      {thumbUrl && !isVideo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt="" loading="lazy" />
      ) : null}
      {!thumbUrl ? <span className="hp-initial">{huddle.title.slice(0, 1).toUpperCase()}</span> : null}
    </div>
  );
}

type When = { label: string; live: boolean; cancelled: boolean };

/**
 * `isLive` comes from the server's live list (started and before its end), the same source the
 * dashboard uses. `is_active` alone is not enough: a scheduled huddle the host never started
 * stays active after its slot has passed.
 */
function when(h: HuddleListItem, isLive: boolean): When {
  if (h.cancelled_at) return { label: 'Cancelled', live: false, cancelled: true };
  if (isLive) return { label: 'Live', live: true, cancelled: false };
  if (h.scheduled_at && slotEnd(h) <= Date.now()) return { label: 'Ended', live: false, cancelled: false };
  if (h.scheduled_at) {
    const d = new Date(h.scheduled_at);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return { label: `${day} · ${time}`, live: false, cancelled: false };
  }
  return { label: 'Open', live: false, cancelled: false };
}

/** Seats taken shown as a compact stack of placeholder heads plus a count. */
function SeatStack({ count, max }: { count: number; max: number }) {
  const shown = Math.min(count, 3);
  return (
    <span className="hcard-stack" aria-label={`${count} of ${max} seats taken`}>
      <span className="hcard-stack-heads" aria-hidden="true">
        {Array.from({ length: Math.max(shown, 1) }, (_, i) => (
          <span key={i} className={`hcard-head ${shown === 0 ? 'hcard-head--empty' : ''}`}>
            <Icon name="user" size={11} />
          </span>
        ))}
      </span>
      <span className="rd-mono">
        {count}/{max}
      </span>
    </span>
  );
}

export function HuddleCard({ h, rank, live = false }: { h: HuddleListItem; rank?: number; live?: boolean }) {
  const w = when(h, live);
  const full = h.participants_count >= h.max_participants;
  const cta = w.cancelled ? 'View' : w.live ? (full ? 'Full' : 'Join') : 'Details';
  return (
    <Link href={`/dashboard/huddles/${h.id}`} className={`hcard ${w.cancelled ? 'hcard--cancelled' : ''}`} aria-label={`${h.title}, ${w.label}`}>
      <div className="hcard-media">
        <HuddlePoster huddle={h} />
        <div className="hcard-badges">
          {w.live ? <span className="rd-badge rd-badge--live">LIVE</span> : null}
          {rank ? <span className="rd-badge hcard-rank">#{rank} trending</span> : null}
          {h.is_owner ? <span className="rd-badge">Yours</span> : null}
          {h.type === 'private' ? (
            <span className="rd-badge">
              <Icon name="lock" size={10} /> Private
            </span>
          ) : null}
        </div>
      </div>
      <div className="hcard-body">
        <div className="hcard-row">
          <h3 className="hcard-title">{h.title}</h3>
          {h.mode && h.mode !== 'open' ? <span className="hcard-mode">{HUDDLE_MODE_LABELS[h.mode]}</span> : null}
        </div>
        {h.intents && h.intents.length ? (
          <p className="hcard-tags">
            {h.intents.slice(0, 3).map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
        ) : null}
        <div className="hcard-foot">
          <SeatStack count={h.participants_count} max={h.max_participants} />
          <span className="hcard-time rd-mono">
            {w.live ? 'now' : w.label}
            {h.duration_minutes ? ` · ${h.duration_minutes}m` : ''}
          </span>
          <span className={`rd-btn rd-btn--sm hcard-cta ${w.live && !full ? 'rd-btn--primary' : ''}`} aria-hidden="true">
            {cta}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function CreateCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="hcard hcard--create" onClick={onClick}>
      <span className="hcard-create-icon">
        <Icon name="plus" size={20} />
      </span>
      <strong>Host a huddle</strong>
      <span className="rd-small rd-muted">Seminars, hackathons, quizzes or just hanging out</span>
    </button>
  );
}

type Tab = 'live' | 'upcoming' | 'mine';
const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'mine', label: 'Mine' },
];

const EMPTY_COPY: Record<Tab, string> = {
  live: 'Nothing live right now. Start one and your connections get a heads-up.',
  upcoming: 'No scheduled huddles yet. Schedule one to give people time to plan.',
  mine: 'You have not hosted a huddle yet.',
};

/** Merge both feeds, de-duplicated by id, keeping the trending order first. */
function mergeFeeds(trendy: HuddleListItem[], live: HuddleListItem[]): HuddleListItem[] {
  const seen = new Set<string>();
  const out: HuddleListItem[] = [];
  for (const h of [...trendy, ...live]) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out;
}

function scheduledTime(h: HuddleListItem): number {
  return h.scheduled_at ? Date.parse(h.scheduled_at) : Number.POSITIVE_INFINITY;
}

/** End of a scheduled huddle's slot (ms); infinite when it has no schedule or no duration. */
function slotEnd(h: HuddleListItem): number {
  if (!h.scheduled_at || !h.duration_minutes) return Number.POSITIVE_INFINITY;
  return Date.parse(h.scheduled_at) + h.duration_minutes * 60_000;
}

export default function HuddleList({
  trendy,
  live,
  loading,
  error,
  onCreate,
}: {
  trendy: HuddleListItem[];
  live: HuddleListItem[];
  loading: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  const [tab, setTab] = useState<Tab>('live');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ live: null, upcoming: null, mine: null });

  const all = useMemo(() => mergeFeeds(trendy, live), [trendy, live]);
  const rankOf = useMemo(() => {
    const map = new Map<string, number>();
    trendy.slice(0, 5).forEach((h, i) => map.set(h.id, i + 1));
    return map;
  }, [trendy]);

  const liveIds = useMemo(() => new Set(live.map((h) => h.id)), [live]);
  const lists = useMemo<Record<Tab, HuddleListItem[]>>(() => {
    const now = Date.now();
    return {
      live: all.filter((h) => liveIds.has(h.id) && !h.cancelled_at),
      upcoming: all
        .filter((h) => !liveIds.has(h.id) && !h.cancelled_at && !!h.scheduled_at && slotEnd(h) > now)
        .sort((a, b) => scheduledTime(a) - scheduledTime(b)),
      mine: all.filter((h) => h.is_owner),
    };
  }, [all, liveIds]);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const items = lists[tab];

  return (
    <>
      <div className="hl-tabs" role="tablist" aria-label="Huddle lists">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`htab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`hpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`hl-tab ${tab === t.id ? 'hl-tab--on' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.id === 'live' ? <span className="hl-tab-dot" aria-hidden="true" /> : null}
            {t.label}
            {!loading ? <span className="hl-tab-count rd-mono">{lists[t.id].length}</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <p className="hl-err" role="alert">
          {error}
        </p>
      ) : null}

      <section id={`hpanel-${tab}`} role="tabpanel" aria-labelledby={`htab-${tab}`} className="hl-panel">
        {loading ? (
          <div className="hgrid" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rd-skeleton hcard-skel" />
            ))}
          </div>
        ) : (
          <>
            <div className="hgrid">
              <CreateCard onClick={onCreate} />
              {items.map((h) => (
                <HuddleCard key={h.id} h={h} live={liveIds.has(h.id)} rank={tab === 'live' ? rankOf.get(h.id) : undefined} />
              ))}
            </div>
            {items.length === 0 ? <p className="rd-small rd-muted hsec-empty">{EMPTY_COPY[tab]}</p> : null}
          </>
        )}
      </section>
    </>
  );
}
