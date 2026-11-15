'use client';

import React from 'react';
import Link from 'next/link';
import { useSignedIn } from '@/hooks/useSignedIn';
import { IconArrowRight } from './icons';

/** Hero and closing call to action: sign up / log in, or straight to the dashboard when signed in. */
export default function AuthCtas() {
  const signedIn = useSignedIn();
  if (signedIn) {
    return (
      <Link href="/dashboard" className="rd-btn rd-btn--primary rd-btn--lg">
        Go to Dashboard
        <IconArrowRight size={15} className="rd-btn-arrow" />
      </Link>
    );
  }
  return (
    <>
      <Link href="/auth/sign-up" className="rd-btn rd-btn--primary rd-btn--lg">
        Get started
        <IconArrowRight size={15} className="rd-btn-arrow" />
      </Link>
      <Link href="/login" className="rd-btn rd-btn--lg">
        Log in
      </Link>
    </>
  );
}
