'use client';

import React from 'react';
import Link from 'next/link';
import { RendlyLockup, RendlyMark, AnoryxSignature } from '@/components/brand/Brand';
import { AlertIcon } from './AuthIcons';
import '@/app/login/login.css';

type TopLink = { href: string; label: string };

interface AuthShellProps {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  topLink?: TopLink;
  wide?: boolean;
}

/** Full-height black canvas with a centered Linear-style auth column. */
export default function AuthShell({ title, subtitle, children, footer, topLink, wide = false }: AuthShellProps) {
  return (
    <div className="au-page">
      <header className="au-topbar">
        <Link href="/" className="au-topbar__home" aria-label="Rendly home">
          <RendlyLockup />
        </Link>
        {topLink && (
          <Link href={topLink.href} className="au-topbar__link">
            {topLink.label}
          </Link>
        )}
      </header>
      <main className="au-main">
        <div className={`au-column${wide ? ' au-column--wide' : ''}`}>
          <div className="au-header au-enter" style={{ '--au-i': 0 } as React.CSSProperties}>
            <RendlyMark className="au-mark" />
            <h1 className="au-title">{title}</h1>
            {subtitle && <p className="au-subtitle">{subtitle}</p>}
          </div>
          {children}
          {footer}
        </div>
      </main>
      <footer className="au-signature">
        <AnoryxSignature />
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
