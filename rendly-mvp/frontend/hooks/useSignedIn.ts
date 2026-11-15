'use client';

import { useSyncExternalStore } from 'react';
import { getStoredAuthToken } from '@/lib/auth-storage';

function subscribe(onChange: () => void): () => void {
  // Another tab logging in or out changes localStorage; this tab follows.
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** Seconds of clock skew allowed when checking a token's expiry. */
const EXPIRY_SKEW_S = 30;

/**
 * True only for a well-formed JWT whose `exp` is still in the future. Stale, expired or malformed
 * tokens left in storage (old sessions, other test accounts) count as signed out, so the home page
 * shows Get started / Log in instead of Go to dashboard.
 */
export function isLiveSessionToken(token: string | null, nowMs: number = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > nowMs + EXPIRY_SKEW_S * 1000;
  } catch {
    return false;
  }
}

const readSignedIn = (): boolean => isLiveSessionToken(getStoredAuthToken());
/** Server render and hydration assume signed out, so the markup matches; the client then updates. */
const readServer = (): boolean => false;

/** True when this browser holds a Rendly session token (public pages swap their sign-in CTAs). */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, readSignedIn, readServer);
}
