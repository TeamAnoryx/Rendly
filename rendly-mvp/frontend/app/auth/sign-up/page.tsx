'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthProvider, useAuth, type ProviderState } from '@/context/AuthContext';
import TermsCheckbox from '@/components/auth/TermsCheckbox';
import ContinueButton from '@/components/auth/ContinueButton';
import AuthShell, { ButtonSpinner, Enter, FormError } from '@/components/auth/AuthShell';
import PasswordInput from '@/components/auth/PasswordInput';
import { CheckIcon, GitHubIcon, InfoIcon, LinkedInIcon } from '@/components/auth/AuthIcons';
import { isNetworkError, networkErrorMessage, NETWORK_ERROR_MESSAGE } from '@/components/auth/network';
import {
  getPasswordStrength,
  isEmailShaped,
  looksLikePersonalEmail,
  MIN_PASSWORD_LENGTH,
} from '@/components/auth/password-strength';
import { useOAuth } from '@/hooks/useOAuth';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { clearAuthStorage, RENDLY_SESSION_TOKEN } from '@/lib/auth-storage';

const GITHUB_STORAGE_KEY = 'rendly_oauth_github';
const LINKEDIN_STORAGE_KEY = 'rendly_oauth_linkedin';
const ERROR_DISMISS_MS = 5000;

const IDS = {
  email: 'signup-email',
  emailHint: 'signup-email-hint',
  emailError: 'signup-email-error',
  password: 'signup-password',
  passwordHint: 'signup-password-hint',
  passwordError: 'signup-password-error',
  terms: 'signup-terms',
  termsError: 'signup-terms-error',
  formError: 'signup-form-error',
};

type FieldErrors = { email?: string; password?: string; terms?: string; form?: string };

function clearVerification() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(GITHUB_STORAGE_KEY);
    localStorage.removeItem(LINKEDIN_STORAGE_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
  window.location.href = '/auth/sign-up';
}

function readStoredProvider(key: string): { user?: Record<string, unknown>; token?: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d?.verified && d?.token ? { user: d.user ?? undefined, token: d.token } : null;
  } catch {
    return null;
  }
}

function describeProviderUser(state: ProviderState): string {
  const u = state.user ?? {};
  const pick = (k: string) => (typeof u[k] === 'string' && (u[k] as string).trim() ? (u[k] as string) : null);
  return pick('email') ?? pick('username') ?? pick('login') ?? pick('name') ?? 'Account connected';
}

function VerifiedRow({ provider, state }: { provider: 'github' | 'linkedin'; state: ProviderState }) {
  const name = provider === 'github' ? 'GitHub' : 'LinkedIn';
  return (
    <div className="au-verified">
      <span className="au-verified__icon">{provider === 'github' ? <GitHubIcon /> : <LinkedInIcon />}</span>
      <div className="au-verified__body">
        <p className="au-verified__title">
          Verified with {name}
          <CheckIcon />
        </p>
        <p className="au-verified__meta">{describeProviderUser(state)}</p>
      </div>
      <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm au-verified__clear" onClick={clearVerification}>
        Change
      </button>
    </div>
  );
}

function SignUpContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    errorMessage,
    setErrorMessage,
    clearError,
    setGithubVerified,
    setLinkedinVerified,
    clearGithub,
    clearLinkedin,
    github,
    linkedin,
    termsChecked,
  } = useAuth();
  const { redirectToGitHub, redirectToLinkedIn } = useOAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const verifiedProvider: 'github' | 'linkedin' | null = github.verified ? 'github' : linkedin.verified ? 'linkedin' : null;
  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const personalEmail = emailTouched && looksLikePersonalEmail(email);

  // Restore an OAuth verification that came back from /auth/callback (stored in localStorage).
  useEffect(() => {
    const gh = readStoredProvider(GITHUB_STORAGE_KEY);
    const li = readStoredProvider(LINKEDIN_STORAGE_KEY);
    try {
      if (gh) {
        if (li) localStorage.removeItem(LINKEDIN_STORAGE_KEY);
        clearLinkedin();
        setGithubVerified({ user: gh.user, token: gh.token });
      } else if (li) {
        clearGithub();
        setLinkedinVerified({ user: li.user, token: li.token });
      }
    } catch {
      // storage unavailable: treat as unverified
    }
    const verified = searchParams.get('verified');
    if (verified === 'github' || verified === 'linkedin') {
      router.replace('/auth/sign-up', { scroll: false });
    }
  }, [searchParams, router, setGithubVerified, setLinkedinVerified, clearGithub, clearLinkedin]);

  useEffect(() => {
    if (!errorMessage) return;
    const t = setTimeout(() => clearError(), ERROR_DISMISS_MS);
    return () => clearTimeout(t);
  }, [errorMessage, clearError]);

  useEffect(() => {
    if (termsChecked) setErrors((prev) => (prev.terms ? { ...prev, terms: undefined } : prev));
  }, [termsChecked]);

  const startOAuth = (provider: 'github' | 'linkedin') => {
    if (verifiedProvider) return;
    setErrorMessage(null);
    if (provider === 'github') redirectToGitHub();
    else redirectToLinkedIn();
  };

  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    const trimmed = email.trim();
    if (!trimmed) next.email = 'Enter your work email.';
    else if (!isEmailShaped(trimmed)) next.email = 'Enter a valid email address.';
    else if (looksLikePersonalEmail(trimmed)) next.email = 'Use your company email address. Personal email providers aren’t supported.';
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!termsChecked) next.terms = 'Agree to the Terms and Privacy Policy to continue.';
    return next;
  }, [email, password, termsChecked]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setEmailTouched(true);
      const found = validate();
      setErrors(found);
      if (Object.values(found).some(Boolean)) {
        const firstId = found.email ? IDS.email : found.password ? IDS.password : IDS.terms;
        document.getElementById(firstId)?.focus();
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErrors({ form: NETWORK_ERROR_MESSAGE });
        return;
      }
      setSubmitting(true);
      try {
        const baseUrl = await getResolvedApiUrl();
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message: string = data?.message || `Sign up failed (server error ${res.status}). Please try again.`;
          if (res.status === 429) setErrors({ form: data?.message || 'Too many attempts. Wait a few minutes and try again.' });
          else if (data?.field === 'email') setErrors({ email: message });
          else if (data?.field === 'password') setErrors({ password: message });
          else setErrors({ form: message });
          setSubmitting(false);
          return;
        }
        const token = data?.accessToken;
        if (!token) {
          setErrors({ form: 'Invalid response from server.' });
          setSubmitting(false);
          return;
        }
        try {
          clearAuthStorage();
          localStorage.setItem(RENDLY_SESSION_TOKEN, token);
        } catch {
          setErrors({ form: 'Could not save your session. Check that storage is enabled.' });
          setSubmitting(false);
          return;
        }
        const continueRes = await fetch(`${baseUrl}/api/auth/continue`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const continueData = await continueRes.json().catch(() => ({}));
        router.push(continueData?.redirectUrl || '/profile-setup');
      } catch (err) {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        setErrors({ form: offline || isNetworkError(err) ? networkErrorMessage() : 'Something went wrong. Please try again.' });
        setSubmitting(false);
      }
    },
    [email, password, router, validate]
  );

  const emailDescribedBy = [errors.email ? IDS.emailError : IDS.emailHint].join(' ');
  const passwordDescribedBy = [IDS.passwordHint, errors.password ? IDS.passwordError : ''].filter(Boolean).join(' ');

  const footer = (
    <Enter index={5}>
      <p className="au-footer-link">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </Enter>
  );

  return (
    <AuthShell
      title="Create your Rendly account"
      subtitle="Use your work email, or continue with GitHub or LinkedIn."
      footer={footer}
    >
      {verifiedProvider ? (
        <>
          <Enter index={1}>
            <VerifiedRow provider={verifiedProvider} state={verifiedProvider === 'github' ? github : linkedin} />
          </Enter>
          <Enter index={2} className="mt-5">
            <TermsCheckbox
              id={IDS.terms}
              invalid={!termsChecked}
              describedBy={!termsChecked ? IDS.termsError : undefined}
            />
            {!termsChecked && (
              <p id={IDS.termsError} className="au-hint" style={{ marginTop: 8 }}>
                <InfoIcon />
                Agree to the Terms to continue.
              </p>
            )}
          </Enter>
          <Enter index={3} className="mt-5 flex flex-col gap-3">
            <FormError message={errorMessage} />
            <ContinueButton />
          </Enter>
        </>
      ) : (
        <>
          <Enter index={1}>
            <form
              onSubmit={handleSubmit}
              className="au-form"
              noValidate
              aria-describedby={errors.form ? IDS.formError : undefined}
            >
              <div className="au-field">
                <label htmlFor={IDS.email} className="rd-label">
                  Work email
                </label>
                <input
                  id={IDS.email}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onBlur={() => setEmailTouched(true)}
                  className="rd-input au-input"
                  disabled={submitting}
                  aria-invalid={errors.email || personalEmail ? true : undefined}
                  aria-describedby={emailDescribedBy}
                  required
                />
                {errors.email ? (
                  <FormError id={IDS.emailError} message={errors.email} field />
                ) : (
                  <p id={IDS.emailHint} className="au-hint">
                    <InfoIcon />
                    {personalEmail
                      ? 'That looks like a personal address. Use your company email.'
                      : 'Use your company address. Personal inboxes like Gmail aren’t accepted.'}
                  </p>
                )}
              </div>

              <div className="au-field">
                <label htmlFor={IDS.password} className="rd-label">
                  Password
                </label>
                <PasswordInput
                  id={IDS.password}
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  disabled={submitting}
                  invalid={!!errors.password}
                  describedBy={passwordDescribedBy}
                  required
                />
                <div className="au-strength" data-level={strength.score} aria-hidden={!password}>
                  <div className="au-strength__bars">
                    {[1, 2, 3, 4].map((n) => (
                      <span key={n} className={`au-strength__bar${strength.score >= n ? ' au-strength__bar--on' : ''}`} />
                    ))}
                  </div>
                  <span className="au-strength__label">{strength.label}</span>
                </div>
                <p id={IDS.passwordHint} className="au-hint">
                  {password ? `Strength: ${strength.label}. ` : ''}
                  Use {MIN_PASSWORD_LENGTH}+ characters. Mixing cases, numbers and symbols makes it stronger.
                </p>
                <FormError id={IDS.passwordError} message={errors.password ?? null} field />
              </div>

              <div className="au-field">
                <TermsCheckbox id={IDS.terms} invalid={!!errors.terms} describedBy={errors.terms ? IDS.termsError : undefined} />
                <FormError id={IDS.termsError} message={errors.terms ?? null} field />
              </div>

              <FormError id={IDS.formError} message={errors.form ?? null} />

              <button
                type="submit"
                className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <ButtonSpinner />
                    <span>Creating account…</span>
                  </>
                ) : (
                  'Create account'
                )}
              </button>
            </form>
          </Enter>

          <Enter index={2}>
            <div className="au-divider">or</div>
          </Enter>

          <Enter index={3}>
            <div className="au-providers">
              <button type="button" className="rd-btn rd-btn--block au-provider" onClick={() => startOAuth('github')} disabled={submitting}>
                <GitHubIcon />
                <span className="au-provider__pre">Continue with </span>GitHub
              </button>
              <button type="button" className="rd-btn rd-btn--block au-provider" onClick={() => startOAuth('linkedin')} disabled={submitting}>
                <LinkedInIcon />
                <span className="au-provider__pre">Continue with </span>LinkedIn
              </button>
            </div>
            <FormError message={errorMessage} />
          </Enter>

          <Enter index={4}>
            <p className="au-legal">After verifying with a provider you&apos;ll come back here to accept the Terms.</p>
          </Enter>
        </>
      )}
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <AuthProvider>
      <SignUpContent />
    </AuthProvider>
  );
}
