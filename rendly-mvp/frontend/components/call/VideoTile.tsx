'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/shell/AppShell';

/** True while the stream has a live, enabled, unmuted video track. */
export function useHasVideo(stream: MediaStream | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!stream) {
      setHas(false);
      return;
    }
    const check = () =>
      setHas(stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled && !t.muted));
    check();
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => {
      t.addEventListener('mute', check);
      t.addEventListener('unmute', check);
      t.addEventListener('ended', check);
    });
    stream.addEventListener('addtrack', check);
    stream.addEventListener('removetrack', check);
    // enabled=false on the local side does not fire events; poll lightly.
    const id = setInterval(check, 1000);
    return () => {
      clearInterval(id);
      tracks.forEach((t) => {
        t.removeEventListener('mute', check);
        t.removeEventListener('unmute', check);
        t.removeEventListener('ended', check);
      });
      stream.removeEventListener('addtrack', check);
      stream.removeEventListener('removetrack', check);
    };
  }, [stream]);
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
}: {
  stream: MediaStream | null;
  label: string;
  avatarUrl?: string | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  forceAvatar?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = useHasVideo(stream);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
  }, [stream, hasVideo]);

  const showAvatar = forceAvatar || !hasVideo;
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
      <span className="call-tile-label">{label}</span>
    </div>
  );
}
