'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';
import AuthShell, { ButtonSpinner, Enter, FormError } from '@/components/auth/AuthShell';
import PasswordInput from '@/components/auth/PasswordInput';
import { ArrowRightIcon, CheckIcon, DotIcon, GitHubIcon, LinkedInIcon } from '@/components/auth/AuthIcons';
import './profile-setup.css';

type UserMe = {
  id: string;
  email: string | null;
  avatar_url: string | null;
  github_id: string | null;
  github_url: string | null;
  linkedin_id: string | null;
  linkedin_url: string | null;
  username?: string | null;
  has_password?: boolean;
};

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_DEBOUNCE_MS = 500;
const REDIRECT_DELAY_MS = 400;

function validateUsername(value: string): boolean {
  const v = value.replace(/^@/, '').trim();
  if (v.length < 3 || v.length > 20) return false;
  return /^[a-zA-Z0-9_]+$/.test(v);
}

function validatePassword(p: string) {
  const length = p.length >= 8;
  const uppercase = /[A-Z]/.test(p);
  const special = /[!@#$%^&*(),.?":{}|<>]/.test(p);
  const number = /[0-9]/.test(p);
  return { length, uppercase, special, number, all: length && uppercase && special && number };
}

function getInitials(email: string | null, githubId: string | null, linkedinId: string | null): string {
  if (email && email.includes('@')) {
    const part = email.split('@')[0];
    return part.length >= 2 ? part.slice(0, 2).toUpperCase() : part.slice(0, 1).toUpperCase();
  }
  if (githubId) return String(githubId).slice(0, 2).toUpperCase();
  if (linkedinId) return String(linkedinId).slice(0, 2).toUpperCase();
  return 'U';
}

function UsernameStatusLine({ status }: { status: UsernameStatus }) {
  if (status === 'idle') {
    return <p className="au-hint">3–20 characters: letters, numbers and underscores.</p>;
  }
  if (status === 'checking') {
    return (
      <p className="au-hint" aria-live="polite">
        <span className="au-spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginTop: 3 }} aria-hidden />
        Checking availability…
      </p>
    );
  }
  if (status === 'available') {
    return (
      <p className="au-hint au-hint--ok" aria-live="polite">
        <CheckIcon />
        Available
      </p>
    );
  }
  return (
    <FormError
      field
      message={status === 'taken' ? 'That username is taken.' : 'Use 3–20 characters: letters, numbers and underscores.'}
    />
  );
}

export default function ProfileSetup() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const usernameCheckTs = useRef(0);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const needsPassword = !user?.has_password;

  useEffect(() => {
    setMounted(true);
    setToken(getStoredAuthToken());
  }, []);

  const fetchUser = useCallback(async (authToken: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const baseUrl = await getResolvedApiUrl();
      const res = await fetch(`${baseUrl}/api/users/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Failed to load profile');
      }
      const data: UserMe = await res.json();
      setUser(data);
      if (data.username) setUsername(String(data.username).replace(/^@/, ''));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load profile');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) {
      setLoading(false);
      return;
    }
    fetchUser(token);
  }, [mounted, token, fetchUser]);

  const checkUsername = useCallback(
    async (value: string) => {
      const normalized = value.replace(/^@/, '').trim().toLowerCase();
      if (!validateUsername(normalized)) {
        setUsernameStatus('invalid');
        return;
      }
      setUsernameStatus('checking');
      const ts = Date.now();
      usernameCheckTs.current = ts;
      try {
        const baseUrl = await getResolvedApiUrl();
        const res = await fetch(`${baseUrl}/api/users/check-username`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ username: normalized }),
        });
        const data = await res.json().catch(() => ({}));
        if (ts !== usernameCheckTs.current) return;
        setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        if (ts === usernameCheckTs.current) setUsernameStatus('idle');
      }
    },
    [token]
  );

  useEffect(() => {
    if (!username.trim()) {
      setUsernameStatus('idle');
      return;
    }
    if (!validateUsername(username)) {
      setUsernameStatus('invalid');
      return;
    }
    const t = setTimeout(() => checkUsername(username), USERNAME_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [username, checkUsername]);

  const passwordReqs = useMemo(() => validatePassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordOk = !needsPassword || (passwordReqs.all && passwordsMatch);
  const formValid = usernameStatus === 'available' && passwordOk && !submitLoading;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formValid || !token) return;
      setSubmitError(null);
      setSubmitLoading(true);
      try {
        const baseUrl = await getResolvedApiUrl();
        const normalized = username.replace(/^@/, '').trim().toLowerCase();
        const body: { username: string; password?: string } = { username: `@${normalized}` };
        if (needsPassword) body.password = password;
        const res = await fetch(`${baseUrl}/api/auth/profile-setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data?.message || 'Failed to save profile');
        setTimeout(() => router.push('/dashboard?welcome=1'), REDIRECT_DELAY_MS);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to save profile');
        setSubmitLoading(false);
      }
    },
    [formValid, token, username, password, needsPassword, router]
  );

  const displayUsername = username.replace(/^@/, '').trim();

  if (!mounted || loading) {
    return (
      <AuthShell title="Set up your profile" subtitle="Loading your account…">
        <div className="ps-skeleton-stack" aria-hidden>
          <div className="ps-skeleton ps-skeleton--avatar" />
          <div className="ps-skeleton ps-skeleton--line" />
          <div className="ps-skeleton ps-skeleton--input" />
          <div className="ps-skeleton ps-skeleton--input" />
        </div>
      </AuthShell>
    );
  }

  if (!token) {
    return (
      <AuthShell title="Sign in to continue" subtitle="Log in or create an account to set up your profile.">
        <Enter index={1} className="flex flex-col gap-2">
          <Link href="/login" className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block">
            Log in
          </Link>
          <Link href="/auth/sign-up" className="rd-btn rd-btn--lg rd-btn--block">
            Create an account
          </Link>
        </Enter>
      </AuthShell>
    );
  }

  if (loadError) {
    return (
      <AuthShell title="Couldn’t load your profile" subtitle="Check your connection and try again.">
        <Enter index={1} className="flex flex-col gap-4">
          <FormError message={loadError} />
          <button type="button" className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block" onClick={() => fetchUser(token)}>
            Retry
          </button>
        </Enter>
      </AuthShell>
    );
  }

  const userIsInvalid = usernameStatus === 'taken' || usernameStatus === 'invalid';

  return (
    <AuthShell
      title="Set up your profile"
      subtitle={needsPassword ? 'Pick a username and a password for signing in.' : 'Pick the username people will find you by.'}
    >
      <Enter index={1}>
        <div className="ps-identity">
          {user?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt="" className="ps-avatar" />
          ) : (
            <span className="ps-avatar ps-avatar--initials" aria-hidden>
              {getInitials(user?.email ?? null, user?.github_id ?? null, user?.linkedin_id ?? null)}
            </span>
          )}
          <div className="ps-identity__body">
            <p className="ps-identity__email">{user?.email ?? 'Your Rendly account'}</p>
            <div className="ps-badges">
              {user?.github_id && (
                <span className="ps-badge">
                  <GitHubIcon />
                  GitHub
                  <CheckIcon className="ps-badge__check" />
                </span>
              )}
              {user?.linkedin_id && (
                <span className="ps-badge">
                  <LinkedInIcon />
                  LinkedIn
                  <CheckIcon className="ps-badge__check" />
                </span>
              )}
              {!user?.github_id && !user?.linkedin_id && user?.has_password && (
                <span className="ps-badge">
                  <CheckIcon className="ps-badge__check" />
                  Work email
                </span>
              )}
            </div>
          </div>
        </div>
      </Enter>

      <Enter index={2}>
        <form className="au-form" onSubmit={submit} noValidate>
          <div className="au-field">
            <label htmlFor="ps-username" className="rd-label">
              Username
            </label>
            <div className="au-input-wrap au-input-wrap--prefix">
              <span className="au-input-prefix" aria-hidden>
                @
              </span>
              <input
                id="ps-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="yourname"
                maxLength={21}
                value={displayUsername}
                onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                className="rd-input au-input"
                style={{ paddingRight: 12 }}
                aria-invalid={userIsInvalid || undefined}
                aria-describedby="ps-username-status"
                required
              />
            </div>
            <div id="ps-username-status">
              <UsernameStatusLine status={usernameStatus} />
            </div>
          </div>

          {needsPassword && (
            <>
              <div className="au-field">
                <label htmlFor="ps-password" className="rd-label">
                  Password
                </label>
                <PasswordInput
                  id="ps-password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  invalid={password.length > 0 && !passwordReqs.all}
                  describedBy="ps-password-reqs"
                  required
                />
                <ul id="ps-password-reqs" className="au-reqs">
                  {(
                    [
                      ['length', 'At least 8 characters'],
                      ['uppercase', 'One uppercase letter'],
                      ['number', 'One number'],
                      ['special', 'One special character'],
                    ] as const
                  ).map(([key, label]) => (
                    <li key={key} data-met={passwordReqs[key]}>
                      {passwordReqs[key] ? <CheckIcon /> : <DotIcon />}
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="au-field">
                <label htmlFor="ps-confirm" className="rd-label">
                  Confirm password
                </label>
                <PasswordInput
                  id="ps-confirm"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  invalid={confirmPassword.length > 0 && !passwordsMatch}
                  describedBy={confirmPassword.length > 0 && !passwordsMatch ? 'ps-mismatch' : undefined}
                  required
                />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <FormError id="ps-mismatch" message="Passwords do not match." field />
                )}
              </div>
            </>
          )}

          <FormError message={submitError} />

          <button
            type="submit"
            className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block"
            disabled={!formValid}
            aria-busy={submitLoading}
          >
            {submitLoading ? (
              <>
                <ButtonSpinner />
                <span>Saving…</span>
              </>
            ) : (
              <>
                <span>Continue to Rendly</span>
                <ArrowRightIcon className="rd-btn-arrow h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </Enter>
    </AuthShell>
  );
}
