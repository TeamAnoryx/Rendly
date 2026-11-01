'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { HuddleListItem } from '@/services/huddlesApi';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { Icon } from '@/components/shell/Icon';

/** Gradient seeded from the huddle id, used when there is no poster. */
function seededGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 60 + (h % 90)) % 360;
  return `linear-gradient(135deg, hsl(${a} 70% 45%), hsl(${b} 75% 30%))`;
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

function when(h: HuddleListItem): { label: string; live: boolean } {
  if (h.cancelled_at) return { label: 'Cancelled', live: false };
  if (h.is_active) return { label: 'Live', live: true };
  if (h.scheduled_at) return { label: new Date(h.scheduled_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), live: false };
  return { label: 'Open', live: false };
}

export function HuddleCard({ h, rank }: { h: HuddleListItem; rank?: number }) {
  const w = when(h);
  return (
    <Link href={`/dashboard/huddles/${h.id}`} className="hcard rd-tilt">
      <HuddlePoster huddle={h} />
      <div className="hcard-badges">
        <span className={`rd-badge ${w.live ? 'rd-badge--live' : ''}`}>{w.label}</span>
        {rank ? <span className="rd-badge hcard-rank">#{rank} trending</span> : null}
        {h.is_owner ? <span className="rd-badge">Yours</span> : null}
      </div>
      <div className="hcard-body">
        <h3>{h.title}</h3>
        <p className="rd-small rd-muted">
          {h.mode && h.mode !== 'open' ? `${HUDDLE_MODE_LABELS[h.mode]} · ` : ''}
          {h.participants_count}/{h.max_participants} people
          {h.type === 'private' ? ' · private' : ''}
        </p>
        {h.intents && h.intents.length ? (
          <p className="hcard-tags">
            {h.intents.slice(0, 3).map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function CreateCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="hcard hcard--create rd-tilt" onClick={onClick}>
      <span className="hcard-create-icon">
        <Icon name="plus" size={28} />
      </span>
      <strong>Host a huddle</strong>
      <span className="rd-small rd-muted">Seminars, hackathons, quizzes or just hanging out</span>
    </button>
  );
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
  if (loading) {
    return (
      <div className="hgrid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rd-skeleton hcard-skel" />
        ))}
      </div>
    );
  }
  const trendTop = trendy.slice(0, 5);
  return (
    <>
      {error ? (
        <p className="hl-err" role="alert">
          {error}
        </p>
      ) : null}
      {trendTop.length ? (
        <section>
          <h2 className="rd-h2 hsec-title">
            <Icon name="spark" size={16} /> Trending now
          </h2>
          <div className="hgrid">
            {trendTop.map((h, i) => (
              <HuddleCard key={h.id} h={h} rank={i + 1} />
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2 className="rd-h2 hsec-title">
          <span className="rd-badge rd-badge--live">LIVE</span> Happening now
        </h2>
        <div className="hgrid">
          <CreateCard onClick={onCreate} />
          {live.map((h) => (
            <HuddleCard key={h.id} h={h} />
          ))}
        </div>
        {live.length === 0 && trendTop.length === 0 ? <p className="rd-small rd-muted hsec-empty">Nothing live right now. Start one and your connections get a heads-up.</p> : null}
      </section>
    </>
  );
}
