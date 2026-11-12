'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RendlyLockup } from '@/components/brand/Brand';
import { IconClose, IconMenu } from './icons';

export const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '#product', label: 'Product' },
  { href: '#spark', label: 'Spark' },
  { href: '#huddles', label: 'Huddles' },
  { href: '#whispers', label: 'Whispers' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the sheet on Escape, on resize to desktop, and lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const mq = window.matchMedia('(min-width: 860px)');
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    sheetRef.current?.querySelector<HTMLElement>('a')?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onMq);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className={`ld-nav${scrolled || open ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
      <div className="ld-container ld-nav-inner">
        <Link href="/" className="ld-nav-brand" aria-label="Rendly home" onClick={close}>
          <RendlyLockup markClassName="h-[18px] w-auto" wordClassName="h-[15px] w-auto" />
        </Link>

        <nav className="ld-nav-links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="ld-nav-link">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ld-nav-actions">
          <Link href="/login" className="rd-btn rd-btn--ghost ld-nav-login">
            Log in
          </Link>
          <Link href="/auth/sign-up" className="rd-btn rd-btn--primary ld-nav-signup">
            Sign up
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="ld-nav-toggle"
            aria-expanded={open}
            aria-controls="ld-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </div>

      <div
        id="ld-mobile-menu"
        ref={sheetRef}
        className="ld-sheet"
        hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <nav className="ld-container ld-sheet-links" aria-label="Mobile">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="ld-sheet-link" onClick={close}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ld-container ld-sheet-actions">
          <Link href="/auth/sign-up" className="rd-btn rd-btn--primary rd-btn--lg rd-btn--block" onClick={close}>
            Sign up
          </Link>
          <Link href="/login" className="rd-btn rd-btn--lg rd-btn--block" onClick={close}>
            Log in
          </Link>
        </div>
      </div>
    </header>
  );
}
