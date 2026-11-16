'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HuddleDetail } from '@/services/huddlesApi';
import HuddleRoom from './HuddleRoom';
import '@/components/call/ongoing.css';

type Rect = { top: number; left: number; width: number; height: number };

// useLayoutEffect warns during server rendering; the host only matters in the browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Track an element's viewport rectangle (resize, scroll, layout shifts). Null when no element. */
export function useElementRect(el: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useIsoLayoutEffect(() => {
    if (!el) {
      setRect(null);
      return undefined;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // Catches moves that change no size (e.g. the page's entry animation).
    const id = setInterval(measure, 500);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearInterval(id);
    };
  }, [el]);
  return rect;
}

export interface HuddleHostProps {
  huddle: HuddleDetail;
  /** The huddle page's stage, or null when the user is on another page. */
  slot: HTMLElement | null;
  paused: boolean;
  onTogglePause: () => void;
  onLeave: () => void;
  onEnd?: () => void;
  canLeave: boolean;
  error: string | null;
}

/**
 * Keeps one HuddleRoom mounted for the whole session. On the huddle page it is laid exactly over
 * the page's stage; elsewhere it is parked off-screen (not unmounted, so media keeps flowing).
 */
export default function HuddleHost({ huddle, slot, paused, onTogglePause, onLeave, onEnd, canLeave, error }: HuddleHostProps): JSX.Element {
  const rect = useElementRect(slot);
  const visible = !!slot && !!rect;
  const hostRef = useRef<HTMLDivElement>(null);
  // Parked: keep it out of the tab order and away from assistive tech.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (visible) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [visible]);

  return (
    <div
      ref={hostRef}
      className={`huddle-host ${visible ? '' : 'huddle-host--parked'}`}
      style={visible && rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
      aria-hidden={visible ? undefined : true}
    >
      {error ? <p className="hl-err hl-room-err">{error}</p> : null}
      <HuddleRoom huddle={huddle} onLeave={onLeave} onEnd={onEnd} canLeave={canLeave} paused={paused} onTogglePause={onTogglePause} />
    </div>
  );
}
