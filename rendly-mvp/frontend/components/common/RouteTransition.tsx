'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RouteLoader } from './RouteLoader';

/** The loader stays at least this long, so quick pages don't flicker it on and off. */
export const MIN_VISIBLE_MS = 300;
/** Hard cap: the loader never blocks the screen longer than this, even if a page stalls. */
export const MAX_VISIBLE_MS = 5000;

/**
 * True for a plain left-click on an internal link that leads to a different page.
 * Read in the capture phase: next/link calls preventDefault() before a bubbling listener runs,
 * so `defaultPrevented` cannot be used to skip clicks here.
 */
export function isInternalNavigation(event: MouseEvent, anchor: HTMLAnchorElement, currentPath: string): boolean {
  if (event.button !== 0) return false;
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

type StartListener = () => void;
const startListeners = new Set<StartListener>();

/**
 * Shows the route loader for a programmatic navigation (router.push / router.replace), which the
 * link-click listener cannot see. Call it right before navigating; the loader then hides itself
 * once the next page and its stylesheets are ready (bounded by MAX_VISIBLE_MS).
 */
export function startRouteTransition(): void {
  startListeners.forEach((listener) => listener());
}

/** Next paint, or 60 ms if frames are paused (background tab), whichever comes first. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 60);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A promise that gives up after `ms`, so one slow font or stylesheet cannot hold the loader. */
function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([p.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

/** Resolves when every <link rel="stylesheet"> on the page has loaded (or failed). */
export function stylesheetsReady(root: Document = document): Promise<void> {
  const pending = Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter(
    (link) => !link.sheet,
  );
  return Promise.all(
    pending.map(
      (link) =>
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
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
    const show = () => {
      clearTimers();
      shownAt.current = Date.now();
      setVisible(true);
      capTimer.current = setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || !isInternalNavigation(event, anchor, pathRef.current)) return;
      show();
    };
    document.addEventListener('click', onClick, true);
    startListeners.add(show);
    return () => {
      document.removeEventListener('click', onClick, true);
      startListeners.delete(show);
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
    // Next adds the new route's stylesheets around the commit: wait two frames, then for every
    // stylesheet and the fonts, so the page is never shown unstyled.
    nextFrame()
      .then(nextFrame)
      .then(() => withTimeout(Promise.all([stylesheetsReady(), document.fonts?.ready ?? Promise.resolve()]), 3000))
      .then(reveal, reveal);
    return () => {
      cancelled = true;
    };
    // Runs when the pathname changes after a click; `visible` gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return visible ? <RouteLoader /> : null;
}
