'use client';

import { useLayoutEffect, useEffect, useState, type RefObject } from 'react';

/** useLayoutEffect on the client, useEffect during SSR (avoids the React warning). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * How many fixed-height rows fit in `ref`'s box. The box must get its height from layout
 * (grid/flex), not from its content, so the answer never feeds back into itself.
 * Falls back to `fallback` where ResizeObserver is missing (tests, very old browsers).
 */
export function useFitCount(
  ref: RefObject<HTMLElement>,
  rowPx: number,
  gapPx: number,
  fallback = 5
): number {
  const [count, setCount] = useState(fallback);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const h = el.clientHeight;
      if (h <= 0) return;
      setCount(Math.max(1, Math.floor((h + gapPx) / (rowPx + gapPx))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rowPx, gapPx]);

  return count;
}

export { useIsoLayoutEffect };
