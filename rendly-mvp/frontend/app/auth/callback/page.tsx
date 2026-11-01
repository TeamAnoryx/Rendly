'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useOAuth } from '@/hooks/useOAuth';
import { LINKEDIN_PKCE_STORAGE_KEY } from '@/lib/pkce';
import { LINK_TO_GITHUB_ID_KEY, RENDLY_SESSION_TOKEN } from '@/lib/auth-storage';

const GITHUB_STORAGE_KEY = 'rendly_oauth_github';
const LINKEDIN_STORAGE_KEY = 'rendly_oauth_linkedin';

export default function CallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { exchangeCode, continueToDashboard } = useOAuth();
  const [status, setStatus] = useState<'exchanging' | 'done' | 'error'>('exchanging');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      setError('Invalid authorization. Missing code or state.');
      setStatus('error');
      return;
    }

    const isLoginFlow = state === 'github_login' || state === 'linkedin_login';
    const provider = state === 'github' || state === 'github_login' ? 'github' : state === 'linkedin' || state === 'linkedin_login' ? 'linkedin' : null;
    if (!provider) {
      setError('Invalid authorization state.');
      setStatus('error');
      return;
    }

    let cancelled = false;
    let exchangeOptions: { codeVerifier?: string; linkToGithubId?: string } | undefined;
    if (provider === 'linkedin' && typeof sessionStorage !== 'undefined') {
      const codeVerifier = sessionStorage.getItem(LINKEDIN_PKCE_STORAGE_KEY) ?? undefined;
      const linkToGithubId = sessionStorage.getItem(LINK_TO_GITHUB_ID_KEY) ?? undefined;
      try {
        sessionStorage.removeItem(LINKEDIN_PKCE_STORAGE_KEY);
        sessionStorage.removeItem(LINK_TO_GITHUB_ID_KEY);
      } catch {
        // ignore
      }
      exchangeOptions = (codeVerifier || linkToGithubId) ? { codeVerifier, linkToGithubId } : undefined;
    }

    exchangeCode(code, provider, exchangeOptions)
      .then((data: { user?: Record<string, unknown>; accessToken?: string }) => {
        if (cancelled) return;
        const key = provider === 'github' ? GITHUB_STORAGE_KEY : LINKEDIN_STORAGE_KEY;
        const otherKey = provider === 'github' ? LINKEDIN_STORAGE_KEY : GITHUB_STORAGE_KEY;
        try {
          localStorage.removeItem(RENDLY_SESSION_TOKEN);
          localStorage.setItem(
            key,
            JSON.stringify({
              verified: true,
              user: data?.user ?? null,
              token: data?.accessToken ?? null,
            })
          );
          localStorage.removeItem(otherKey);
        } catch {
          // ignore storage errors
        }
        if (provider === 'github') {
          console.log('[Rendly] User has verified GitHub successfully. Data has been updated in the users table in Supabase.');
        } else {
          console.log('[Rendly] User has verified LinkedIn successfully. Data has been updated in the users table in Supabase.');
        }
        setStatus('done');
        if (isLoginFlow) {
          continueToDashboard()
            .then((redirectUrl) => {
              if (!cancelled) router.replace(redirectUrl);
            })
            .catch(() => {
              if (!cancelled) router.replace('/dashboard');
            });
        } else {
          router.replace(`/auth/sign-up?verified=${provider}`);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const raw = err?.message ?? '';
        const isNetwork = raw === 'Failed to fetch' || raw.includes('NetworkError') || raw.includes('Load failed');
        const message = isNetwork
          ? `Cannot reach the auth server. Start the backend (e.g. run auth-service on port 4001) and try again.`
          : (raw || `Failed to authenticate with ${provider}. Please try again.`);
        setError(message);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams, router, exchangeCode]);

  if (status === 'exchanging') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-glaucous border-t-transparent" />
        <p className="mt-4 text-sm text-muted-foreground">Authenticating...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <p className="text-center text-dusty_grape font-medium max-w-md">{error}</p>
        <a
          href="/login"
          className="mt-4 px-4 py-2 rounded-lg bg-space_indigo text-white text-sm font-medium hover:brightness-110 transition-all"
        >
          Back to Login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <p className="text-center text-foreground">Redirecting...</p>
    </div>
  );
}
