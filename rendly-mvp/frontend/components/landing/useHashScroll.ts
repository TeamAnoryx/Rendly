'use client';

import { useEffect } from 'react';

const MAX_FRAMES = 60;

/**
 * The landing is mounted client-side after the intro, so the browser's own
 * jump to `/#spark` happens before the target exists. Retry for ~1s of frames.
 */
export function useHashScroll(): void {
  useEffect(() => {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return; // Malformed hash (e.g. "#%E0"): nothing to scroll to.
    }
    if (!id) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
      frame += 1;
      if (frame < MAX_FRAMES) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
