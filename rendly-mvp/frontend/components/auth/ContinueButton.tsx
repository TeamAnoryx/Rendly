'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useOAuth } from '@/hooks/useOAuth';
import { ArrowRightIcon } from './AuthIcons';

/** Continues a verified GitHub/LinkedIn sign-up to profile setup or the dashboard. Requires AuthProvider. */
export default function ContinueButton() {
  const router = useRouter();
  const { canContinue, setErrorMessage } = useAuth();
  const { continueToDashboard } = useOAuth();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!canContinue || loading) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const redirectUrl = await continueToDashboard();
      router.push(redirectUrl);
    } catch {
      setErrorMessage('Unable to continue. Please try again.');
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canContinue || loading}
      aria-busy={loading}
      className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block"
    >
      {loading ? (
        <>
          <span className="au-spinner" aria-hidden />
          <span>Continuing…</span>
        </>
      ) : (
        <>
          <span>Continue</span>
          <ArrowRightIcon className="rd-btn-arrow h-4 w-4" />
        </>
      )}
    </button>
  );
}
