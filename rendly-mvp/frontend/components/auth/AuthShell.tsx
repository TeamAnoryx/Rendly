'use client';

import React from 'react';
import Link from 'next/link';
import { RendlyLockup, AnoryxSignature } from '@/components/brand/Brand';
import { AlertIcon } from './AuthIcons';
import '@/app/login/login.css';

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

/** Full-height black canvas with a centered auth column; the brand lockup leads, no top bar. */
export default function AuthShell({ title, subtitle, children, footer, wide = false }: AuthShellProps) {
  return (
    <div className="au-page">
      <main className="au-main">
        <div className={`au-column${wide ? ' au-column--wide' : ''}`}>
          <div className="au-header au-enter" style={{ '--au-i': 0 } as React.CSSProperties}>
            <Link href="/" className="au-brand" aria-label="Rendly home">
              <RendlyLockup className="au-lockup" />
            </Link>
            <h1 className="au-title">{title}</h1>
            {subtitle && <p className="au-subtitle">{subtitle}</p>}
          </div>
          {children}
          {footer}
        </div>
      </main>
      <footer className="au-signature">
        <AnoryxSignature size="lg" />
      </footer>
    </div>
  );
}

/** Staggered entrance wrapper. */
export function Enter({ index, children, className = '' }: { index: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`au-enter ${className}`} style={{ '--au-i': index } as React.CSSProperties}>
      {children}
    </div>
  );
}

export function FormError({ id, message, field = false }: { id?: string; message: string | null; field?: boolean }) {
  if (!message) return null;
  return (
    <p id={id} className={`au-error${field ? ' au-error--field' : ''}`} role="alert">
      <AlertIcon />
      <span>{message}</span>
    </p>
  );
}

export function ButtonSpinner() {
  return <span className="au-spinner" aria-hidden />;
}
