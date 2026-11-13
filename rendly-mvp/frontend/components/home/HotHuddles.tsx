'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNowStrict, isToday, isTomorrow } from 'date-fns';
import { getHotHuddles, type HotHuddle, type HotReason } from '@/services/huddlesApi';
import { DASHBOARD_REFRESH_MS } from '@/hooks/useDashboard';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';

const HOT_LIMIT = 5;
const SKELETON_KEYS = [0, 1, 2, 3, 4];

/** Quiet gradient seeded from the huddle id, used when the host has not set a poster. */
function seededGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = 200 + (h % 60);
  const angle = 110 + (h % 120);
  return `radial-gradient(120% 90% at 20% 0%, hsl(${hue} 10% 22%), transparent 60%), linear-gradient(${angle}deg, hsl(${hue} 8% 12%), hsl(${hue} 10% 7%))`;
}

/** Badge copy for an upcoming huddle: "Starts in 12 min", "Today 18:00", "Tomorrow 18:00" or "Fri 18:00". */
export function startsLabel(h: Pick<HotHuddle, 'scheduled_at' | 'starts_in_seconds'>, nowMs = Date.now()): string {
  const startMs = h.scheduled_at ? Date.parse(h.scheduled_at) : NaN;
  const secs = h.starts_in_seconds ?? (Number.isNaN(startMs) ? null : Math.round((startMs - nowMs) / 1000));
  if (secs != null && secs <= 0) return 'Starting now';
  if (secs != null && secs < 3600) return `Starts in ${Math.max(1, Math.round(secs / 60))} min`;
  if (Number.isNaN(startMs)) return secs != null ? `Starts in ${formatDistanceToNowStrict(new Date(nowMs + secs * 1000))}` : 'Upcoming';
  const start = new Date(startMs);
  const time = format(start, 'HH:mm');
  if (isToday(start)) return `Today ${time}`;
  if (isTomorrow(start)) return `Tomorrow ${time}`;
  return `${format(start, 'EEE')} ${time}`;
}

type Badge = { label: string; variant: 'live' | 'soon' | 'upcoming' | 'buzz' };

function badgeFor(h: HotHuddle): Badge {
  const reason: HotReason = h.is_live ? 'live' : h.hot_reason;
  switch (reason) {
    case 'live':
      return { label: 'Live now', variant: 'live' };
    case 'starting_soon':
      return { label: startsLabel(h), variant: 'soon' };
    case 'upcoming':
      return { label: startsLabel(h), variant: 'upcoming' };
    default:
      return { label: 'Buzzing', variant: 'buzz' };
  }
}

function HotCard({ h }: { h: HotHuddle }) {
  const badge = badgeFor(h);
  const href = `/dashboard/huddles/${encodeURIComponent(h.id)}`;
  const full = h.participants_count >= h.max_participants;
  const cta = h.is_live ? (full ? 'Full' : 'Join') : 'Open';
  const hostName = h.host?.username ? `@${h.host.username}` : 'Host';
  return (
    <Link href={href} className={`home-hot-card ${h.is_live ? 'home-hot-card--live' : ''}`} aria-label={`${h.title}, ${badge.label}`}>
      <div className="home-hot-thumb" style={h.thumbnail_url ? undefined : { background: seededGradient(h.id) }}>
        {h.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={h.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <span className="home-hot-initial" aria-hidden>
            {h.title.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={`home-hot-badge home-hot-badge--${badge.variant}`}>
          {badge.variant === 'live' ? <span className="home-hot-badge-dot" aria-hidden /> : null}
          {badge.label}
        </span>
      </div>
      <div className="home-hot-body">
        <h3 className="home-hot-title">{h.title}</h3>
        <p className="home-hot-host">
          <Avatar url={h.host?.avatar_url} name={h.host?.username} size="sm" />
          <span className="home-hot-host-name">{hostName}</span>
        </p>
        <p className="home-hot-stats">
          <span className="home-num">{h.participants_count}</span> in · <span className="home-num">{h.invites_count}</span> invited
        </p>
        <span className={`rd-btn rd-btn--sm home-hot-cta ${h.is_live && !full ? 'rd-btn--primary' : ''}`} aria-hidden>
          {cta}
        </span>
      </div>
    </Link>
  );
}

export default function HotHuddles() {
  const [items, setItems] = useState<HotHuddle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getHotHuddles(HOT_LIMIT);
      setItems(list.slice(0, HOT_LIMIT));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hot huddles');
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, DASHBOARD_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const loading = items === null;

  return (
    <section className="rd-card home-panel home-hot" aria-labelledby="home-hot-title">
      <header className="home-panel-head">
        <h2 id="home-hot-title" className="rd-h2">
          <Icon name="flame" size={15} className="home-hot-flame" />
          Top 5 Hot Huddles
        </h2>
        <Link href="/dashboard/huddles" className="rd-btn rd-btn--ghost rd-btn--sm">
          See all <Icon name="arrow-right" size={13} className="rd-btn-arrow" />
        </Link>
      </header>
      {error ? (
        <p className="rd-small home-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="home-hot-strip" aria-busy="true">
          {SKELETON_KEYS.map((i) => (
            <div key={i} className="home-hot-card home-hot-card--skel" aria-hidden>
              <div className="rd-skeleton home-hot-thumb" />
              <div className="home-hot-body">
                <div className="rd-skeleton home-skel-line" />
                <div className="rd-skeleton home-skel-line home-skel-line--short" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="shell-empty home-hot-empty">
          <span className="shell-empty-icon" aria-hidden>
            <Icon name="flame" size={18} />
          </span>
          <p>Nothing hot yet — host one</p>
          <Link href="/dashboard/huddles?create=1" className="rd-btn rd-btn--sm">
            <Icon name="plus" size={14} /> Host a huddle
          </Link>
        </div>
      ) : (
        <div className="home-hot-strip">
          {items.map((h) => (
            <HotCard key={h.id} h={h} />
          ))}
        </div>
      )}
    </section>
  );
}
