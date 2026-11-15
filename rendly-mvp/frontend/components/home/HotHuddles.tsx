'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { format, formatDistanceToNowStrict, isToday, isTomorrow } from 'date-fns';
import { getHotHuddles, type HotHuddle, type HotReason } from '@/services/huddlesApi';
import { getResolvedApiUrlSync } from '@/lib/resolvedApiUrl';
import { DASHBOARD_REFRESH_MS } from '@/hooks/useDashboard';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import './HotHuddles.css';

const HOT_LIMIT = 5;
const SKELETON_KEYS = [0, 1, 2, 3, 4];
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i;
const EASE = [0.16, 1, 0.3, 1] as const;

/** Quiet monochrome gradient seeded from the huddle id, used when there is no poster. */
function seededGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const angle = 110 + (h % 120);
  const lift = 14 + (h % 8);
  return `radial-gradient(120% 90% at 18% 0%, hsl(220 4% ${lift}%), transparent 62%), linear-gradient(${angle}deg, hsl(220 3% 10%), hsl(220 4% 5%))`;
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

type BadgeVariant = 'live' | 'soon' | 'upcoming' | 'buzz';
type Badge = { label: string; variant: BadgeVariant };

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

type Media = { url: string; kind: 'image' | 'video' };

/** Make a storage path absolute against the API origin; absolute URLs pass through untouched. */
function absoluteUrl(url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url) || url.startsWith('//')) return url;
  const base = getResolvedApiUrlSync();
  if (!base) return url;
  return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/**
 * The poster to show for a huddle. Hosts can upload either a still image or a short promo
 * video as the thumbnail, so the kind comes from `thumbnail_type` (or the file extension for
 * rows that predate that column). Falls back to the huddle's own image/video media.
 */
export function mediaFor(h: Pick<HotHuddle, 'thumbnail_url' | 'thumbnail_type' | 'media_url' | 'media_type'>): Media | null {
  if (h.thumbnail_url) {
    const video = h.thumbnail_type === 'video' || (h.thumbnail_type == null && VIDEO_EXT.test(h.thumbnail_url));
    return { url: absoluteUrl(h.thumbnail_url), kind: video ? 'video' : 'image' };
  }
  if (h.media_url && (h.media_type === 'image' || h.media_type === 'video')) {
    return { url: absoluteUrl(h.media_url), kind: h.media_type };
  }
  return null;
}

function HotMedia({ h, reduceMotion }: { h: HotHuddle; reduceMotion: boolean }) {
  const media = mediaFor(h);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaUrl = media?.url;

  useEffect(() => setFailed(false), [mediaUrl]);

  // React does not reliably reflect `muted` as an attribute, which blocks autoplay in some browsers.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    if (reduceMotion) {
      el.pause();
      return;
    }
    el.play().catch(() => {
      /* autoplay refused: the first frame stays visible as a poster */
    });
  }, [mediaUrl, reduceMotion]);

  const showMedia = media && !failed;
  return (
    <div className="hh-media" style={showMedia ? undefined : { background: seededGradient(h.id) }}>
      {showMedia && media.kind === 'video' ? (
        <video
          ref={videoRef}
          className="hh-media-el"
          src={reduceMotion ? `${media.url}#t=0.1` : media.url}
          muted
          loop
          playsInline
          autoPlay={!reduceMotion}
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          onError={() => setFailed(true)}
        />
      ) : showMedia ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="hh-media-el" src={media.url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="hh-initial" aria-hidden>
          {h.title.trim().slice(0, 1).toUpperCase() || '#'}
        </span>
      )}
      <span className="hh-scrim" aria-hidden />
    </div>
  );
}

function HotBadge({ badge }: { badge: Badge }) {
  return (
    <span className={`hh-badge hh-badge--${badge.variant}`}>
      {badge.variant === 'live' || badge.variant === 'soon' ? <span className="hh-badge-dot" aria-hidden /> : null}
      {badge.label}
    </span>
  );
}

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE } },
};

function HotCard({ h, reduceMotion, rank }: { h: HotHuddle; reduceMotion: boolean; rank: number }) {
  const badge = badgeFor(h);
  const href = `/dashboard/huddles/${encodeURIComponent(h.id)}`;
  const full = h.participants_count >= h.max_participants;
  const cta = h.is_live ? (full ? 'Full' : 'Join') : 'Open';
  const hostName = h.host?.username ? `@${h.host.username}` : 'Host';
  return (
    <motion.li className="hh-item" variants={reduceMotion ? undefined : cardVariants}>
      <Link
        href={href}
        className={`hh-card ${h.is_live ? 'hh-card--live' : ''}`}
        aria-label={`${h.title}, ${badge.label}, hosted by ${hostName}`}
      >
        <HotMedia h={h} reduceMotion={reduceMotion} />
        <div className="hh-overlay">
          <span className="hh-badges">
            <HotBadge badge={badge} />
            {!h.is_live && h.rescheduled_at ? <span className="hh-badge hh-badge--moved">Rescheduled</span> : null}
          </span>
          <span className="hh-rank" aria-hidden>
            {String(rank).padStart(2, '0')}
          </span>
        </div>
        <div className="hh-body">
          <h3 className="hh-title" title={h.title}>
            {h.title}
          </h3>
          <p className="hh-host">
            <Avatar url={h.host?.avatar_url} name={h.host?.username} size="sm" />
            <span className="hh-host-name">{hostName}</span>
          </p>
          <div className="hh-foot">
            <p className="hh-stats">
              <span className="hh-num">{h.participants_count}</span> in
              <span className="hh-sep" aria-hidden>
                ·
              </span>
              <span className="hh-num">{h.invites_count}</span> invited
            </p>
            <span className={`hh-cta ${h.is_live && !full ? 'hh-cta--solid' : ''}`} aria-hidden>
              {cta}
              <Icon name="arrow-right" size={12} />
            </span>
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

export default function HotHuddles({ className }: { className?: string }) {
  const [items, setItems] = useState<HotHuddle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

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
  const liveCount = items?.filter((h) => h.is_live).length ?? 0;

  return (
    <section className={`hh ${className ?? ''}`} aria-labelledby="hh-title">
      <header className="hh-head">
        <div className="hh-head-text">
          <span className="hh-eyebrow">
            <Icon name="flame" size={12} />
            {liveCount > 0 ? `${liveCount} live now` : 'Trending'}
          </span>
          <h2 id="hh-title" className="hh-heading">
            Top 5 Hot Huddles
          </h2>
        </div>
        <Link href="/dashboard/huddles" className="hh-seeall">
          See all <Icon name="arrow-right" size={13} />
        </Link>
      </header>

      {error ? (
        <p className="hh-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <ul className="hh-rail" aria-busy="true" aria-label="Loading hot huddles">
          {SKELETON_KEYS.map((i) => (
            <li key={i} className="hh-item" aria-hidden>
              <div className="hh-card hh-card--skel">
                <div className="hh-media hh-shimmer" />
                <div className="hh-body">
                  <div className="hh-skel-line hh-shimmer" />
                  <div className="hh-skel-line hh-skel-line--short hh-shimmer" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <motion.div
          className="hh-empty"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <span className="hh-empty-icon" aria-hidden>
            <Icon name="flame" size={18} />
          </span>
          <p className="hh-empty-title">Nothing hot yet</p>
          <p className="hh-empty-sub">Start one and it could top this list.</p>
          <Link href="/dashboard/huddles?create=1" className="hh-cta hh-cta--solid hh-empty-cta">
            <Icon name="plus" size={13} /> Host a huddle
          </Link>
        </motion.div>
      ) : (
        <motion.ul
          className="hh-rail"
          variants={reduceMotion ? undefined : listVariants}
          initial={reduceMotion ? false : 'hidden'}
          animate="show"
        >
          {items.map((h, i) => (
            <HotCard key={h.id} h={h} rank={i + 1} reduceMotion={reduceMotion} />
          ))}
        </motion.ul>
      )}
    </section>
  );
}
