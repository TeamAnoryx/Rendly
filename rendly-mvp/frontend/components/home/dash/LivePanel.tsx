'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { Huddle, UpcomingHuddle } from '@/hooks/useDashboard';
import { formatTimeLeft } from '@/lib/huddleActive';
import { HUDDLE_MODE_LABELS } from '@/services/huddlesApi';
import { Icon } from '@/components/shell/Icon';
import './live-panel.css';

/** Rows that fit the panel without scrolling; the rest are one click away under "See all". */
const MAX_LIVE = 3;
const MAX_UPCOMING = 3;

export interface LivePanelProps {
  huddles: Huddle[];
  upcoming?: UpcomingHuddle[];
  loading: boolean;
  error: string | null;
  joinError: string | null;
  joiningId: string | null;
  onJoin: (h: Huddle) => void;
  onRetry: () => void;
  className?: string;
}

function joinLabel(h: Pick<Huddle, 'canJoin' | 'isParticipant' | 'waitingRoom'>): string {
  if (h.isParticipant) return 'Rejoin';
  if (!h.canJoin) return 'Full';
  if (h.waitingRoom) return 'Request';
  return 'Join';
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/** Square preview: video thumbnails play muted, images fit whole, a letter if neither loads. */
function Thumb({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (title.trim()[0] ?? 'H').toUpperCase();
  if (!url || failed) {
    return (
      <span className="lp-thumb lp-thumb--letter" aria-hidden>
        {letter}
      </span>
    );
  }
  return (
    <span className="lp-thumb" aria-hidden>
      {VIDEO_EXT.test(url) ? (
        <video src={url} muted loop autoPlay playsInline preload="metadata" onError={() => setFailed(true)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

function startsAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Today · ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

export default function LivePanel({
  huddles,
  upcoming = [],
  loading,
  error,
  joinError,
  joiningId,
  onJoin,
  onRetry,
  className,
}: LivePanelProps) {
  const live = huddles.slice(0, MAX_LIVE);
  const soon = upcoming.slice(0, MAX_UPCOMING);
  const nothing = !loading && huddles.length === 0 && upcoming.length === 0;

  return (
    <section className={`lp ${className ?? ''}`} aria-labelledby="lp-title">
      <header className="lp-head">
        <h2 id="lp-title" className="lp-title">
          Live huddles
          {huddles.length ? (
            <span className="lp-count">
              <span className="lp-dot" aria-hidden /> {huddles.length} live
            </span>
          ) : null}
        </h2>
        <Link href="/dashboard/huddles" className="lp-link">
          See all <Icon name="arrow-right" size={13} />
        </Link>
      </header>

      {joinError ? (
        <p className="lp-error" role="alert">
          {joinError}
        </p>
      ) : null}
      {error && !loading ? (
        <p className="lp-error" role="alert">
          {error}{' '}
          <button type="button" className="lp-retry" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="lp-body">
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="rd-skeleton lp-skel" />)
        ) : nothing ? (
          <div className="lp-empty">
            <span className="lp-empty-icon" aria-hidden>
              <Icon name="huddle" size={18} />
            </span>
            <p>No huddles live or coming up.</p>
            <Link href="/dashboard/huddles?create=1" className="rd-btn rd-btn--sm">
              <Icon name="plus" size={14} /> Start one
            </Link>
          </div>
        ) : (
          <>
            {live.length ? (
              <ul className="lp-list" aria-label="Live now">
                {live.map((h) => {
                  const joining = joiningId === h.id;
                  const enabled = (h.canJoin || h.isParticipant) && !joiningId;
                  return (
                    <li key={h.id} className="lp-row">
                      <Thumb url={h.thumbnailUrl} title={h.topic} />
                      <div className="lp-main">
                        <p className="lp-name">
                          <span className="lp-name-text">{h.topic}</span>
                          {h.isOwner ? <span className="lp-chip">Yours</span> : null}
                          {h.mode && h.mode !== 'open' ? <span className="lp-chip">{HUDDLE_MODE_LABELS[h.mode]}</span> : null}
                        </p>
                        <p className="lp-meta">
                          <span className="lp-live">
                            <span className="lp-dot" aria-hidden /> Live
                          </span>
                          <span>
                            {h.participantsCount}
                            {h.maxParticipants != null ? `/${h.maxParticipants}` : ''} in
                          </span>
                          <span>{formatTimeLeft(h.timeLeftSeconds)}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`rd-btn rd-btn--sm ${enabled && !h.isParticipant ? 'rd-btn--primary' : ''}`}
                        disabled={!enabled}
                        onClick={() => onJoin(h)}
                        aria-label={`${joinLabel(h)} ${h.topic}`}
                      >
                        {joining ? <span className="rd-spinner" /> : joinLabel(h)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="lp-note">Nothing live right now.</p>
            )}

            {soon.length ? (
              <>
                <p className="lp-section">Upcoming</p>
                <ul className="lp-list" aria-label="Upcoming">
                  {soon.map((u) => (
                    <li key={u.id} className="lp-row">
                      <Thumb url={u.thumbnailUrl} title={u.title} />
                      <div className="lp-main">
                        <p className="lp-name">
                          <span className="lp-name-text">{u.title}</span>
                          {u.isOwner ? <span className="lp-chip">Yours</span> : null}
                          {u.rescheduled ? <span className="lp-chip lp-chip--moved">Rescheduled</span> : null}
                        </p>
                        <p className="lp-meta">
                          <span>{startsAt(u.scheduledAt)}</span>
                          {u.durationMinutes ? <span>{u.durationMinutes}m</span> : null}
                        </p>
                      </div>
                      <Link href={`/dashboard/huddles/${encodeURIComponent(u.id)}`} className="rd-btn rd-btn--sm">
                        Details
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
