'use client';

/**
 * Sends page views on every route change, a heartbeat every 15 s while the tab is visible
 * (time on site), an app open per session, a sign-in when a session token appears and a
 * sign-up when a new account reaches profile setup. The admin console is not tracked.
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { sessionId, track } from '@/lib/analytics';
import { getStoredAuthToken } from '@/lib/auth-storage';

const HEARTBEAT_MS = 15_000;
const SIGNED_IN_KEY = 'rendly_tracked_signin';
const UNTRACKED = /^\/(admin|film-capture)(\/|$)/;

export default function Tracker() {
  const pathname = usePathname() ?? '/';
  const pathRef = useRef(pathname);
  const firstView = useRef(true);
  pathRef.current = pathname;

  useEffect(() => {
    if (UNTRACKED.test(pathname)) return;
    const { isNew } = sessionId();
    const referrer = firstView.current && document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : null;
    if (isNew) void track('app_open', pathname, { referrer });
    void track('pageview', pathname, { referrer });
    firstView.current = false;
    if (pathname === '/profile-setup') void track('signup', pathname);
    try {
      const token = getStoredAuthToken();
      if (token && sessionStorage.getItem(SIGNED_IN_KEY) !== token.slice(-16)) {
        sessionStorage.setItem(SIGNED_IN_KEY, token.slice(-16));
        void track('signin', pathname);
      }
    } catch {
      // Storage unavailable: skip the sign-in event.
    }
  }, [pathname]);

  useEffect(() => {
    let last = Date.now();
    const beat = () => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (document.visibilityState !== 'visible' || UNTRACKED.test(pathRef.current)) return;
      void track('heartbeat', pathRef.current, { duration_ms: Math.min(elapsed, 60_000) });
    };
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') beat();
      else last = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
