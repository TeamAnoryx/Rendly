'use client';

import React, { useEffect, useRef } from 'react';
import { Icon } from '@/components/shell/Icon';
import './ongoing.css';

export interface OngoingCardProps {
  /** e.g. "Ongoing huddle · Friday chat" */
  text: string;
  onResume: () => void;
  /** Extra controls (mute, end) shown before Resume. */
  children?: React.ReactNode;
}

/** Small floating card for a call or huddle that keeps running while its view is hidden. */
export function OngoingCard({ text, onResume, children }: OngoingCardProps): JSX.Element {
  return (
    <div className="ongoing-card" role="status" aria-label={text}>
      <span className="ongoing-card-dot" aria-hidden="true" />
      <span className="ongoing-card-text">{text}</span>
      {children ? <span className="ongoing-card-extra">{children}</span> : null}
      <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={onResume}>
        Resume
      </button>
    </div>
  );
}

/** Covers a tile whose owner paused (or is reconnecting); their last frame stays underneath. */
export function PausedOverlay({ label }: { label: string | null }): JSX.Element | null {
  if (!label) return null;
  return (
    <div className="paused-overlay" role="status">
      <Icon name={label === 'Paused' ? 'pause' : 'clock'} size={16} />
      <span>{label}</span>
    </div>
  );
}

/** While `frozen` is true, keep returning the value it had when freezing began. */
export function useFrozenWhile<T>(frozen: boolean, value: T): T {
  const held = useRef<{ value: T } | null>(null);
  if (!frozen) held.current = null;
  else if (!held.current) held.current = { value };
  return held.current ? held.current.value : value;
}

/** Hold a <video> on its current frame while `frozen`; play again when it ends. */
export function useFreezeVideo(
  ref: React.RefObject<HTMLVideoElement>,
  frozen: boolean,
  stream: MediaStream | null,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (frozen) el.pause();
    else if (stream && el.paused) {
      // Autoplay can refuse a resume; retry on the next tap instead of staying frozen.
      el.play().catch(() => {
        window.addEventListener('pointerdown', () => void el.play().catch(() => undefined), { once: true });
      });
    }
  }, [ref, frozen, stream]);
}

export default OngoingCard;
