'use client';

import { useCallback } from 'react';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import {
  generateCodeVerifier,
  computeCodeChallenge,
  LINKEDIN_PKCE_STORAGE_KEY,
} from '@/lib/pkce';
import { GITHUB_STORAGE_KEY, LINK_TO_GITHUB_ID_KEY, getStoredAuthToken } from '@/lib/auth-storage';

function normalizeRedirectUri(value: string): string {
  if (!value) return value;
  return value.trim().replace(/\/+$/, '');
}

function getRedirectUri() {
  if (typeof window === 'undefined') return '';
  // Override for provider dashboards: set NEXT_PUBLIC_OAUTH_REDIRECT_URI to match exactly what you registered.
  // We normalize it to avoid mismatches from trailing slash variants.
  const envUri = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URI;
  if (envUri) return normalizeRedirectUri(envUri);
  return normalizeRedirectUri(`${window.location.origin}/auth/callback`);
}

export type OAuthFlow = 'login' | 'signup';

export function useOAuth() {
  const redirectToGitHub = useCallback((flow: OAuthFlow = 'signup') => {
    const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    if (!clientId) {
      console.error('NEXT_PUBLIC_GITHUB_CLIENT_ID is not set');
      return;
    }
    const redirectUri = getRedirectUri();
    const scope = encodeURIComponent('read:user user:email');
    const state = flow === 'login' ? 'github_login' : 'github';
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
    window.location.href = url;
  }, []);

  const redirectToLinkedIn = useCallback(async (flow: OAuthFlow = 'signup') => {
    const clientId = process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID;
    if (!clientId) {
      console.error('NEXT_PUBLIC_LINKEDIN_CLIENT_ID is not set');
      return;
    }
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    try {
      sessionStorage.setItem(LINKEDIN_PKCE_STORAGE_KEY, verifier);
      // If user already verified GitHub, link LinkedIn to that same user row
      const ghRaw = typeof window !== 'undefined' ? localStorage.getItem(GITHUB_STORAGE_KEY) : null;
      if (ghRaw) {
        const d = JSON.parse(ghRaw);
        if (d?.verified && d?.user?.id) sessionStorage.setItem(LINK_TO_GITHUB_ID_KEY, String(d.user.id));
      }
    } catch {
      // ignore
    }
    const redirectUri = encodeURIComponent(getRedirectUri());
    const scope = encodeURIComponent('openid profile email');
    const state = flow === 'login' ? 'linkedin_login' : 'linkedin';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      scope: 'openid profile email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    window.location.href = url;
  }, []);

  const exchangeCode = useCallback(
    async (code: string, provider: 'github' | 'linkedin', options?: { codeVerifier?: string; linkToGithubId?: string }) => {
      const baseUrl = await getResolvedApiUrl();
      const endpoint =
        provider === 'github'
          ? `${baseUrl}/api/auth/github/callback`
          : `${baseUrl}/api/auth/linkedin/callback`;
      const body: { code: string; code_verifier?: string; link_to_github_id?: string; client_ip?: string } = { code };
      if (provider === 'linkedin' && options?.codeVerifier) body.code_verifier = options.codeVerifier;
      if (provider === 'linkedin' && options?.linkToGithubId) body.link_to_github_id = options.linkToGithubId;
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          if (ipData?.ip) body.client_ip = ipData.ip;
        }
      } catch {
        // ignore; backend will use request IP
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (body.client_ip) headers['X-Client-IP'] = body.client_ip;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = `Failed to authenticate with ${provider}.`;
        try {
          const err = text ? JSON.parse(text) : {};
          message = err?.message || err?.error_description || err?.error || message;
        } catch {
          if (text && text.length < 200) message = text;
        }
        throw new Error(message);
      }
      return res.json();
    },
    []
  );

  const continueToDashboard = useCallback(async () => {
    const baseUrl = await getResolvedApiUrl();
    const token = typeof window !== 'undefined' ? getStoredAuthToken() : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/api/auth/continue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to continue');
    const data = await res.json();
    return data.redirectUrl || '/profile-setup';
  }, []);

  return {
    redirectToGitHub,
    redirectToLinkedIn,
    exchangeCode,
    continueToDashboard,
    getRedirectUri,
  };
}
