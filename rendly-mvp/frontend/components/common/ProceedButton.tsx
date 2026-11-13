'use client';

import React from 'react';
import Link from 'next/link';

interface ProceedButtonProps {
  shouldShow?: boolean;
  delay?: number;
}

export function ProceedButton({ shouldShow = true }: ProceedButtonProps) {
  if (!shouldShow) return null;

  return (
    <Link
      href="/login"
      prefetch
      className="rd-btn rd-btn--primary rd-btn--lg"
      style={{ animation: 'proceedFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      Continue to Rendly
      <svg
        className="rd-btn-arrow"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

export default ProceedButton;
