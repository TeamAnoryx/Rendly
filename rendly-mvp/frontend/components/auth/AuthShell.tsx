'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { RendlyLockup, AnoryxSignature } from '@/components/brand/Brand';
import PovOrbit from '@/components/motion/PovOrbit';
import { AlertIcon } from './AuthIcons';
import '@/app/login/login.css';

interface AuthShellProps {
  title: string;
  /** Optional second line of the title, set dimmed under the lead line. */
  accent?: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

/**
 * Pointer-driven light: writes `--au-px/--au-py` (-0.5..0.5 of the viewport) on the page for the
 * stage parallax, and `--au-mx/--au-my` (px inside the card) for the card spotlight. One rAF per
 * frame at most, no React state, nothing under reduced motion or on coarse pointers.
 */
function usePointerLight(pageRef: React.RefObject<HTMLDivElement>, cardRef: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const page = pageRef.current;
    const card = cardRef.current;
    if (!page || !card) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(pointer: fine)');
    if (reduced.matches || !fine.matches) return;

    let frame = 0;
    let last: PointerEvent | null = null;
    const flush = () => {
      frame = 0;
      if (!last) return;
      const { clientX, clientY } = last;
      page.style.setProperty('--au-px', (clientX / window.innerWidth - 0.5).toFixed(4));
      page.style.setProperty('--au-py', (clientY / window.innerHeight - 0.5).toFixed(4));
      const r = card.getBoundingClientRect();
      card.style.setProperty('--au-mx', `${(clientX - r.left).toFixed(1)}px`);
      card.style.setProperty('--au-my', `${(clientY - r.top).toFixed(1)}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pageRef, cardRef]);
}

const vars = (v: Record<string, number>) => v as unknown as React.CSSProperties;

/**
 * Auth layout. Phones and portrait tablets: one centred column. 1024px and up: a split page, the
 * form column on the left over a drifting monochrome glow, and a stage on the right where the POV
 * orbit turns along the screen edge beside a large display line.
 */
export default function AuthShell({ title, accent, subtitle, children, footer, wide = false }: AuthShellProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  usePointerLight(pageRef, cardRef);

  return (
    <div className="au-page" ref={pageRef}>
      <div className="au-bg" aria-hidden="true">
        <span className="au-bg__glow au-bg__glow--a" />
        <span className="au-bg__glow au-bg__glow--b" />
        <span className="au-bg__glow au-bg__glow--c" />
        <span className="au-bg__grid" />
        <span className="au-bg__grain" />
      </div>

      <div className="au-side">
        <header className="au-top au-enter" style={vars({ '--au-i': 0 })}>
          <Link href="/" className="au-brand" aria-label="Rendly home">
            <RendlyLockup className="au-lockup" />
          </Link>
        </header>

        <main className="au-main">
          <div className={`au-column${wide ? ' au-column--wide' : ''}`}>
            <div className="au-header">
              <h1 className="au-title">
                <span className="au-title__lead au-enter" style={vars({ '--au-i': 1 })}>
                  {title}
                </span>
                {accent && (
                  <span className="au-title__accent au-enter" style={vars({ '--au-i': 2 })}>
                    {accent}
                  </span>
                )}
              </h1>
              {subtitle && (
                <p className="au-subtitle au-enter" style={vars({ '--au-i': accent ? 3 : 2 })}>
                  {subtitle}
                </p>
              )}
            </div>

            <div className="au-card" ref={cardRef} style={vars({ '--au-base': 3 })}>
              <span className="au-card__ring" aria-hidden="true" />
              <span className="au-card__spot" aria-hidden="true" />
              <div className="au-card__body">{children}</div>
            </div>

            {footer && (
              <div className="au-after" style={vars({ '--au-base': 4 })}>
                {footer}
              </div>
            )}
          </div>
        </main>

        <footer className="au-signature au-signature--column au-enter" style={vars({ '--au-i': 9 })}>
          <AnoryxSignature size="lg" />
        </footer>
      </div>

      <aside className="au-stage" aria-label="About Rendly">
        <PovOrbit className="au-orbit" parallax />
        <div className="au-stage__veil" aria-hidden="true" />
        <div className="au-stage__copy">
          <p className="au-eyebrow">
            <span className="au-eyebrow__dot" aria-hidden="true" />
            Live, face-to-face, matched by intent
          </p>
          <p className="au-display">
            <span className="au-display__line au-display__line--lead">Know your why.</span>
            <span className="au-display__line au-display__line--dim">
              Find your <span className="au-display__who">who.</span>
            </span>
          </p>
          <p className="au-stage__sub">
            Rendly matches you with people who want what you want, then puts you face to face in seconds.
          </p>
          <div className="au-signature au-signature--stage">
            <AnoryxSignature size="lg" />
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Staggered entrance wrapper. */
export function Enter({ index, children, className = '' }: { index: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`au-enter ${className}`} style={vars({ '--au-i': index })}>
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
