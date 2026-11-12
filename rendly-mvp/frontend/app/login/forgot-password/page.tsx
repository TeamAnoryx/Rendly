'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { getResolvedApiUrl } from '@/lib/resolvedApiUrl';
import AuthShell, { ButtonSpinner, Enter, FormError } from '@/components/auth/AuthShell';
import { isNetworkError, networkErrorMessage } from '@/components/auth/network';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const raw = email.trim();
    if (!raw) {
      setError('Enter the email on your account.');
      return;
    }
    setLoading(true);
    try {
      const baseUrl = await getResolvedApiUrl();
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || 'Request failed. Please try again.');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(isNetworkError(err) ? networkErrorMessage() : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={sent ? 'Check your inbox' : 'Reset your password'}
      subtitle={
        sent
          ? 'If an account exists for that email, we’ve sent a link to reset your password. It expires in one hour.'
          : 'Enter the email on your Rendly account and we’ll send you a reset link.'
      }
      footer={
        <Enter index={3}>
          <p className="au-footer-link">
            Remembered it? <Link href="/login">Back to log in</Link>
          </p>
        </Enter>
      }
    >
      {sent ? (
        <Enter index={1}>
          <p className="au-notice" role="status">
            Didn&apos;t get it? Check spam, or{' '}
            <button type="button" className="au-terms__link" onClick={() => setSent(false)}>
              try another email
            </button>
            .
          </p>
        </Enter>
      ) : (
        <Enter index={1}>
          <form onSubmit={handleSubmit} className="au-form" noValidate>
            <div className="au-field">
              <label htmlFor="forgot-email" className="rd-label">
                Email
              </label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rd-input au-input"
                disabled={loading}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'forgot-error' : undefined}
                required
              />
            </div>
            <FormError id="forgot-error" message={error} />
            <button type="submit" className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block" disabled={loading} aria-busy={loading}>
              {loading ? (
                <>
                  <ButtonSpinner />
                  <span>Sending…</span>
                </>
              ) : (
                'Send reset link'
              )}
            </button>
          </form>
        </Enter>
      )}
    </AuthShell>
  );
}
