'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { clearAuthStorage, RENDLY_SESSION_TOKEN } from '@/lib/auth-storage';
import { useOAuth } from '@/hooks/useOAuth';
import AuthShell, { ButtonSpinner, Enter, FormError } from '@/components/auth/AuthShell';
import PasswordInput from '@/components/auth/PasswordInput';
import { startRouteTransition } from '@/components/common/RouteTransition';
import { GitHubIcon, LinkedInIcon } from '@/components/auth/AuthIcons';
import { isNetworkError, networkErrorMessage, NETWORK_ERROR_MESSAGE } from '@/components/auth/network';

const ERROR_ID = 'login-error';

export default function LoginPage() {
  const router = useRouter();
  const { redirectToGitHub, redirectToLinkedIn } = useOAuth();
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('reset') === '1') {
      setNotice('Your password was reset. Log in with your new password.');
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const raw = emailOrUsername.trim();
      if (!raw || !password) {
        setError('Enter your email or username and your password.');
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError(NETWORK_ERROR_MESSAGE);
        return;
      }
      setLoading(true);
      try {
        const baseUrl = await getResolvedApiUrl();
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email_or_username: raw, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 429) {
            setError(data?.message || 'Too many login attempts. Wait a few minutes and try again.');
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
          setError('Could not save your session. Check that cookies and storage are enabled.');
          return;
        }
        const continueRes = await fetch(`${baseUrl}/api/auth/continue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const continueData = await continueRes.json().catch(() => ({}));
        startRouteTransition();
        router.push(continueData?.redirectUrl || '/dashboard');
      } catch (err) {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        setError(offline || isNetworkError(err) ? networkErrorMessage() : 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }
      // Keep the spinner while the router navigates away; only reset on handled errors above.
    },
    [emailOrUsername, password, router]
  );

  // Reset loading when an error was set inside the try block (early returns).
  useEffect(() => {
    if (error) setLoading(false);
  }, [error]);

  return (
    <AuthShell
      title="Log in to Rendly"
      subtitle="Welcome back. Pick up where your conversations left off."
      footer={
        <Enter index={4}>
          <p className="au-footer-link">
            Don&apos;t have an account? <Link href="/auth/sign-up">Sign up</Link>
          </p>
        </Enter>
      }
    >
      {notice && (
        <Enter index={1} className="mb-4">
          <p className="au-notice" role="status">
            {notice}
          </p>
        </Enter>
      )}
      <Enter index={1}>
        <form onSubmit={handleSubmit} className="au-form" noValidate aria-describedby={error ? ERROR_ID : undefined}>
          <div className="au-field">
            <label htmlFor="login-identifier" className="rd-label">
              Email or username
            </label>
            <input
              id="login-identifier"
              name="username"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@company.com or username"
              value={emailOrUsername}
              onChange={(e) => setEmailOrUsername(e.target.value)}
              className="rd-input au-input"
              disabled={loading}
              aria-invalid={error ? true : undefined}
              required
            />
          </div>
          <div className="au-field">
            <div className="au-label-row">
              <label htmlFor="login-password" className="rd-label">
                Password
              </label>
              <Link href="/login/forgot-password" className="au-inline-link">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="Your password"
              disabled={loading}
              invalid={!!error}
              required
            />
          </div>
          <FormError id={ERROR_ID} message={error} />
          <button
            type="submit"
            className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <ButtonSpinner />
                <span>Logging in…</span>
              </>
            ) : (
              'Log in'
            )}
          </button>
        </form>
      </Enter>

      <Enter index={2}>
        <div className="au-divider">or</div>
      </Enter>

      <Enter index={3}>
        <div className="au-providers">
          <button
            type="button"
            className="rd-btn rd-btn--block au-provider"
            onClick={() => redirectToGitHub('login')}
            disabled={loading}
          >
            <GitHubIcon />
            <span className="au-provider__pre">Continue with </span>GitHub
          </button>
          <button
            type="button"
            className="rd-btn rd-btn--block au-provider"
            onClick={() => redirectToLinkedIn('login')}
            disabled={loading}
          >
            <LinkedInIcon />
            <span className="au-provider__pre">Continue with </span>LinkedIn
          </button>
        </div>
      </Enter>
    </AuthShell>
  );
}
