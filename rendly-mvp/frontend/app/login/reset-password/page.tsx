'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import { validatePassword } from '@/hooks/useProfile';
import AuthShell, { ButtonSpinner, Enter, FormError } from '@/components/auth/AuthShell';
import PasswordInput from '@/components/auth/PasswordInput';
import { isNetworkError, NETWORK_ERROR_MESSAGE } from '@/components/auth/network';

const REDIRECT_DELAY_MS = 1500;

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const validation = validatePassword(password);
  const passwordsMatch = password.length > 0 && password === confirm;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!validation.isValid) {
        setError('Password does not meet the requirements.');
        return;
      }
      if (!passwordsMatch) {
        setError('Passwords do not match.');
        return;
      }
      setLoading(true);
      try {
        const baseUrl = await getResolvedApiUrl();
        const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, new_password: password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.message || 'Reset failed. Request a new link and try again.');
          return;
        }
        setSuccess(true);
        setTimeout(() => router.push('/login?reset=1'), REDIRECT_DELAY_MS);
      } catch (err) {
        setError(isNetworkError(err) ? NETWORK_ERROR_MESSAGE : 'Something went wrong. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [token, password, passwordsMatch, validation.isValid, router]
  );

  const footer = (
    <Enter index={3}>
      <p className="au-footer-link">
        <Link href="/login">Back to log in</Link>
      </p>
    </Enter>
  );

  if (!token) {
    return (
      <AuthShell title="Invalid reset link" subtitle="This link is missing or has expired." footer={footer}>
        <Enter index={1}>
          <Link href="/login/forgot-password" className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block">
            Request a new link
          </Link>
        </Enter>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={success ? 'Password updated' : 'Set a new password'}
      subtitle={success ? 'Taking you to log in…' : 'Choose a strong password you don’t use elsewhere.'}
      footer={footer}
    >
      {!success && (
        <Enter index={1}>
          <form onSubmit={handleSubmit} className="au-form" noValidate>
            <div className="au-field">
              <label htmlFor="reset-password" className="rd-label">
                New password
              </label>
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="New password"
                disabled={loading}
                invalid={password.length > 0 && !validation.isValid}
                describedBy="reset-reqs"
                required
              />
              <ul id="reset-reqs" className="au-reqs" aria-live="polite">
                {validation.errors.length === 0 && password.length > 0 ? (
                  <li data-met="true">Meets all requirements</li>
                ) : (
                  validation.errors.map((err: string) => <li key={err}>{err}</li>)
                )}
              </ul>
            </div>
            <div className="au-field">
              <label htmlFor="reset-confirm" className="rd-label">
                Confirm password
              </label>
              <PasswordInput
                id="reset-confirm"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                placeholder="Repeat password"
                disabled={loading}
                invalid={confirm.length > 0 && !passwordsMatch}
                describedBy={confirm.length > 0 && !passwordsMatch ? 'reset-mismatch' : undefined}
                required
              />
              {confirm.length > 0 && !passwordsMatch && (
                <FormError id="reset-mismatch" message="Passwords do not match." field />
              )}
            </div>
            <FormError message={error} />
            <button
              type="submit"
              className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block"
              disabled={loading || !validation.isValid || !passwordsMatch}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <ButtonSpinner />
                  <span>Updating…</span>
                </>
              ) : (
                'Update password'
              )}
            </button>
          </form>
        </Enter>
      )}
    </AuthShell>
  );
}
