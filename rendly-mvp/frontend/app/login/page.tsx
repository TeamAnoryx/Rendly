'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { clearAuthStorage, RENDLY_SESSION_TOKEN } from '@/lib/auth-storage';
import { useOAuth } from '@/hooks/useOAuth';
import './login.css';

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20.5c0-3.5 3.13-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const LOADER_DELAY_MS = 300;

const NETWORK_ERROR_MESSAGE = 'No internet connection. Please check your network and try again.';

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && (err.message === 'Failed to fetch' || err.message?.includes('fetch'))) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('connection')) return true;
  }
  return false;
}

export default function LoginPage() {
  const router = useRouter();
  const { redirectToGitHub, redirectToLinkedIn } = useOAuth();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const loaderTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoaderTimer = useCallback(() => {
    if (loaderTimerRef.current) {
      clearTimeout(loaderTimerRef.current);
      loaderTimerRef.current = null;
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const raw = emailOrUsername.trim();
      if (!raw || !password) {
        setError('Please enter your email or username and password.');
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError(NETWORK_ERROR_MESSAGE);
        return;
      }
      setLoading(true);
      setShowLoader(false);
      loaderTimerRef.current = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);

      try {
        const baseUrl = await getResolvedApiUrl();
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email_or_username: raw, password }),
        });
        if (res.status === 0) {
          setError(NETWORK_ERROR_MESSAGE);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setError(NETWORK_ERROR_MESSAGE);
          } else if (res.status === 429) {
            setError(data?.message || 'Too many login attempts. Please wait a few minutes and try again.');
          } else if (res.status === 401 || res.status === 400) {
            setError(data?.message || 'Invalid email/username or password.');
          } else {
            setError(data?.message || `Login failed (server error ${res.status}). Please try again.`);
          }
          return;
        }
        const token = data?.accessToken;
        if (!token) {
          setError('Invalid response from server.');
          return;
        }
        try {
          clearAuthStorage();
          localStorage.setItem(RENDLY_SESSION_TOKEN, token);
        } catch {
          setError('Could not save session.');
          return;
        }
        // Warm API URL cache so dashboard never waits on first resolution
        await getResolvedApiUrl();
        const continueRes = await fetch(`${baseUrl}/api/auth/continue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const continueData = await continueRes.json().catch(() => ({}));
        const redirectUrl = continueData?.redirectUrl || '/dashboard';
        router.push(redirectUrl);
      } catch (err) {
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        setError(isOffline || isNetworkError(err) ? NETWORK_ERROR_MESSAGE : 'Something went wrong. Please try again.');
      } finally {
        clearLoaderTimer();
        setLoading(false);
        setShowLoader(false);
      }
    },
    [emailOrUsername, password, router, clearLoaderTimer]
  );

  React.useEffect(() => () => clearLoaderTimer(), [clearLoaderTimer]);

  return (
    <div className="login-page">
      <div className="login-page__overlay" aria-hidden />
      <div className="login-page__inner login-page__inner--enter">
        <h1 className="login-page__title">Log in to Rendly</h1>
        <p className="login-page__subtitle">Sign in with your account or use a provider below</p>

        <div className="login-page__card login-page__card--enter">
          <form onSubmit={handleSubmit} className="login-page__form" noValidate>
            <div className="login-page__field">
              <label htmlFor="login-email-or-username" className="login-page__label">
                Email or username
              </label>
              <div className="login-page__input-wrap">
                <span className="login-page__input-icon" aria-hidden>
                  <UserIcon className="login-page__input-svg" />
                </span>
                <input
                  id="login-email-or-username"
                  type="text"
                  autoComplete="username email"
                  placeholder="you@example.com or @username"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  className="login-page__input"
                  disabled={loading}
                  aria-invalid={!!error}
                />
              </div>
            </div>
            <div className="login-page__field">
              <div className="login-page__label-row">
                <label htmlFor="login-password" className="login-page__label">
                  Password
                </label>
                <Link href="/login/forgot-password" className="login-page__forgot">
                  Forgot password?
                </Link>
              </div>
              <div className="login-page__input-wrap">
                <span className="login-page__input-icon" aria-hidden>
                  <LockIcon className="login-page__input-svg" />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-page__input"
                  disabled={loading}
                  aria-invalid={!!error}
                />
                <button
                  type="button"
                  className="login-page__toggle-password"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {error && (
              <div className="login-page__error" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="login-page__submit"
              disabled={loading}
              aria-busy={loading}
            >
              {showLoader && loading ? (
                <span className="login-page__spinner" aria-hidden />
              ) : (
                'Log in'
              )}
            </button>
          </form>

          <p className="login-page__divider" aria-hidden>
            or sign in with
          </p>

          <div className="login-page__providers">
            <button
              type="button"
              className="login-page__provider-btn login-page__provider-btn--github"
              onClick={() => redirectToGitHub('login')}
              disabled={loading}
              aria-label="Sign in with GitHub"
            >
              <GitHubIcon className="login-page__provider-icon" />
              <span>GitHub</span>
            </button>
            <button
              type="button"
              className="login-page__provider-btn login-page__provider-btn--linkedin"
              onClick={() => redirectToLinkedIn('login')}
              disabled={loading}
              aria-label="Sign in with LinkedIn"
            >
              <LinkedInIcon className="login-page__provider-icon" />
              <span>LinkedIn</span>
            </button>
          </div>
        </div>

        <p className="login-page__signup-cta">
          Don&apos;t have an account?{' '}
          <Link href="/auth/sign-up" className="login-page__signup-link">
            Create new account
          </Link>
        </p>
      </div>
    </div>
  );
}
