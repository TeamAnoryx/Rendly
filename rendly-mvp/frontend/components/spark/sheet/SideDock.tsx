'use client';

import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const DOCK_QUERY = '(orientation: landscape) and (min-width: 1180px) and (min-height: 560px)';
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type Box = { top: number; height: number };

/** The right-column dock target on wide screens; null where the right column is hidden. */
function useDockTarget(): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(DOCK_QUERY);
    const sync = () => setTarget(mq.matches ? document.getElementById('spark-side-slot') : null);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return target;
}

/** Tracks the intent sheet's box (summary + panel) relative to the dock's positioned parent. */
function useSheetBox(target: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useIsoLayoutEffect(() => {
    if (!target) return undefined;
    const sheet = document.querySelector<HTMLElement>('.is-sheet');
    const parent = target.offsetParent as HTMLElement | null;
    if (!sheet || !parent) return undefined;
    const measure = () => {
      const s = sheet.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      setBox({ top: Math.round(s.top - p.top), height: Math.round(s.height) });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(sheet);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [target]);
  return box;
}

export type SideDockProps = {
  /** Accessible name of the docked panel. */
  label: string;
  /** Shown in the sheet while the content is docked on the right. */
  hint: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Renders `children` in a white card that slides in on the right column, aligned to the
 * intent sheet's top and height. On narrower screens the children render inline instead.
 */
export default function SideDock({ label, hint, children }: SideDockProps) {
  const target = useDockTarget();
  const box = useSheetBox(target);
  if (!target) return <>{children}</>;
  return (
    <>
      <p className="is-dock-hint">{hint}</p>
      {createPortal(
        <section
          className="is-dock"
          aria-label={label}
          style={box ? { top: box.top, height: box.height } : { visibility: 'hidden' }}
        >
          <div className="is-dock-body">{children}</div>
        </section>,
        target
      )}
    </>
  );
}
