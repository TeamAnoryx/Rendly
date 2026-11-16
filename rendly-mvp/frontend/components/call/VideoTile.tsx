'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/shell/AppShell';
import { PausedOverlay, useFrozenWhile, useFreezeVideo } from './OngoingCard';

/** True while the stream has a live, enabled, unmuted video track. */
/** How long a video track may report `muted` (no frames) before the tile falls back to the avatar. */
const MUTE_GRACE_MS = 1500;

function liveTrack(t: MediaStreamTrack): boolean {
  return t.readyState === 'live' && t.enabled;
}

/**
 * True while the stream carries a live, enabled video track.
 * A track that briefly reports `muted` (a static screen share, a congested camera) keeps the
 * video visible for a grace period instead of blinking to the avatar; screen shares ignore
 * `muted` entirely because a still screen produces no frames.
 */
export function useHasVideo(stream: MediaStream | null, ignoreMute = false): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!stream) {
      setHas(false);
      return undefined;
    }
    let grace: ReturnType<typeof setTimeout> | null = null;
    const clearGrace = () => {
      if (grace) clearTimeout(grace);
      grace = null;
    };
    const flowing = () => stream.getVideoTracks().some((t) => liveTrack(t) && (ignoreMute || !t.muted));
    const check = () => {
      if (flowing()) {
        clearGrace();
        setHas(true);
        return;
      }
      if (!stream.getVideoTracks().some(liveTrack)) {
        clearGrace();
        setHas(false);
        return;
      }
      // Live but muted: only hide if it stays muted.
      if (!grace) {
        grace = setTimeout(() => {
          grace = null;
          setHas(flowing());
        }, MUTE_GRACE_MS);
      }
    };
    const bound = new Set<MediaStreamTrack>();
    const bind = () => {
      stream.getVideoTracks().forEach((t) => {
        if (bound.has(t)) return;
        bound.add(t);
        t.addEventListener('mute', check);
        t.addEventListener('unmute', check);
        t.addEventListener('ended', check);
      });
    };
    const onTracks = () => {
      bind();
      check();
    };
    onTracks();
    stream.addEventListener('addtrack', onTracks);
    stream.addEventListener('removetrack', check);
    // enabled=false on the local side does not fire events; poll lightly.
    const id = setInterval(check, 1000);
    return () => {
      clearInterval(id);
      clearGrace();
      bound.forEach((t) => {
        t.removeEventListener('mute', check);
        t.removeEventListener('unmute', check);
        t.removeEventListener('ended', check);
      });
      stream.removeEventListener('addtrack', onTracks);
      stream.removeEventListener('removetrack', check);
    };
  }, [stream, ignoreMute]);
  return has;
}

export function VideoTile({
  stream,
  label,
  avatarUrl,
  muted = false,
  mirror = false,
  fit = 'cover',
  className = '',
  forceAvatar = false,
  pausedLabel = null,
}: {
  stream: MediaStream | null;
  label: string;
  avatarUrl?: string | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  forceAvatar?: boolean;
  /** "Paused" / "Reconnecting…" when this person froze their media; the last frame stays visible. */
  pausedLabel?: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = useHasVideo(stream, fit === 'contain');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream && el.paused && !pausedLabel) el.play().catch(() => undefined);
  }, [stream, hasVideo, pausedLabel]);

  // A paused tile keeps what it showed (its last frame, or the avatar) until it resumes.
  const showAvatar = useFrozenWhile(!!pausedLabel, forceAvatar || !hasVideo);
  useFreezeVideo(ref, !!pausedLabel, stream);
  return (
    <div className={`call-tile ${className}`}>
      {/* Audio keeps playing through the <video> element even when the avatar covers it. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`call-tile-video ${mirror ? 'call-tile-video--mirror' : ''}`}
        style={{ objectFit: fit, opacity: showAvatar ? 0 : 1 }}
      />
      {showAvatar ? (
        <div className="call-tile-avatar">
          <Avatar url={avatarUrl} name={label} size="lg" />
        </div>
      ) : null}
      <PausedOverlay label={pausedLabel} />
      <span className="call-tile-label">{label}</span>
    </div>
  );
}
