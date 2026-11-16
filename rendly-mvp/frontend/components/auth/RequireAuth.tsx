'use client';

import React, { useLayoutEffect, useState } from 'react';
import { getStoredAuthToken } from '@/lib/auth-storage';
import { withBasePath } from '@/lib/basePath';

/** Where a signed-out visitor lands when they reach a signed-in page (for example via Back). */
const SIGNED_OUT_HOME = '/';

/**
 * Renders children only when a session token is stored. Without one it replaces the history
 * entry with the home page, so Back after logout never shows an empty signed-in screen.
 * Also re-checks pages restored from the back/forward cache, which skip React effects.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useLayoutEffect(() => {
    if (getStoredAuthToken()) {
      setAllowed(true);
    } else {
      window.location.replace(withBasePath(SIGNED_OUT_HOME));
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !getStoredAuthToken()) window.location.replace(withBasePath(SIGNED_OUT_HOME));
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return allowed ? <>{children}</> : null;
}

export default RequireAuth;
