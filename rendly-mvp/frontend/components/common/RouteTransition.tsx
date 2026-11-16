'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RouteLoader } from './RouteLoader';

/** The loader stays at least this long, so quick pages don't flicker it on and off. */
export const MIN_VISIBLE_MS = 300;
/** Hard cap: the loader never blocks the screen longer than this, even if a page stalls. */
export const MAX_VISIBLE_MS = 5000;

/** True for a plain left-click on an internal link that leads to a different page. */
export function isInternalNavigation(event: MouseEvent, anchor: HTMLAnchorElement, currentPath: string): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== currentPath;
}

/**
 * Covers the screen with the branded loader from the moment an internal link is clicked until
 * the next page has rendered, so a half-loaded page is never seen. Shown for at least
 * MIN_VISIBLE_MS and at most MAX_VISIBLE_MS.
 */
export default function RouteTransition() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const clearTimers = () => {
      if (capTimer.current) clearTimeout(capTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || !isInternalNavigation(event, anchor, pathRef.current)) return;
      clearTimers();
      shownAt.current = Date.now();
      setVisible(true);
      capTimer.current = setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clearTimers();
    };
  }, []);

  // The new page has rendered: wait for fonts, honour the minimum, then reveal it.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const reveal = () => {
      if (cancelled) return;
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
      hideTimer.current = setTimeout(() => setVisible(false), remaining);
    };
    const fonts = typeof document !== 'undefined' ? document.fonts?.ready : undefined;
    if (fonts) fonts.then(reveal, reveal);
    else reveal();
    return () => {
      cancelled = true;
    };
    // Runs when the pathname changes after a click; `visible` gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return visible ? <RouteLoader /> : null;
}
