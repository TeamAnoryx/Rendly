import React from 'react';
import Link from 'next/link';
import { AnoryxSignature, RendlyLockup } from '@/components/brand/Brand';
import Reveal from './Reveal';
import AuthCtas from './AuthCtas';

export function FinalCta() {
  return (
    <section className="ld-cta" aria-labelledby="ld-cta-title">
      <div className="ld-cta-bg" aria-hidden="true" />
      <div className="ld-container ld-cta-inner">
        <Reveal as="h2" className="ld-cta-title">
          <span id="ld-cta-title">Find your who.</span>
        </Reveal>
        <Reveal as="p" delay={60} className="ld-lede ld-lede--center">
          Choose your intents and meet someone who shares them today.
        </Reveal>
        <Reveal delay={120} className="ld-hero-ctas ld-hero-ctas--center">
          <AuthCtas />
        </Reveal>
      </div>
    </section>
  );
}

interface FooterLink {
  label: string;
  /** Omit to render the item as "coming soon" text. */
  href?: string;
}

const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<FooterLink> }> = [
  {
    title: 'Product',
    links: [
      { label: 'Spark', href: '/#spark' },
      { label: 'Whispers', href: '/#whispers' },
      { label: 'Huddles', href: '/#huddles' },
      { label: 'Sign up', href: '/auth/sign-up' },
      { label: 'Log in', href: '/login' },
    ],
  },
  {
    title: 'Company',
    links: [{ label: 'About', href: '/about' }, { label: 'Careers' }, { label: 'Contact' }],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="ld-footer">
      <div className="ld-container">
        <div className="ld-footer-top">
          <div className="ld-footer-brand">
            <RendlyLockup className="h-8 w-auto" />
            <p className="ld-footer-tag">Know your why. Find your who.</p>
          </div>
          <nav className="ld-footer-cols" aria-label="Footer">
            {COLUMNS.map((c) => (
              <div key={c.title} className="ld-footer-col">
                <h3 className="ld-footer-h">{c.title}</h3>
                <ul>
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.href ? (
                        <Link href={l.href} className="ld-footer-link">
                          {l.label}
                        </Link>
                      ) : (
                        <span className="ld-footer-link is-soon" aria-disabled="true">
                          {l.label}
                          <span className="ld-footer-soon">Soon</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="ld-footer-bottom">
          <span className="ld-footer-copy">© 2026 Anoryx</span>
          <AnoryxSignature />
        </div>
      </div>
    </footer>
  );
}
