import React from 'react';
import Link from 'next/link';
import { AnoryxSignature, RendlyLockup } from '@/components/brand/Brand';
import Reveal from './Reveal';
import { IconArrowRight } from './icons';

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
          <Link href="/auth/sign-up" className="rd-btn rd-btn--primary rd-btn--lg">
            Get started
            <IconArrowRight size={15} className="rd-btn-arrow" />
          </Link>
          <Link href="/login" className="rd-btn rd-btn--lg">
            Log in
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

const COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<{ label: string; href: string }> }> = [
  {
    title: 'Product',
    links: [
      { label: 'Spark', href: '#spark' },
      { label: 'Whispers', href: '#whispers' },
      { label: 'Huddles', href: '#huddles' },
      { label: 'Sign up', href: '/auth/sign-up' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Careers', href: '#' },
      { label: 'Contact', href: '#' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '#' },
      { label: 'Privacy', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="ld-footer">
      <div className="ld-container">
        <div className="ld-footer-top">
          <div className="ld-footer-brand">
            <RendlyLockup markClassName="h-[18px] w-auto" wordClassName="h-[15px] w-auto" />
            <p className="ld-footer-tag">Know your why. Find your who.</p>
          </div>
          <nav className="ld-footer-cols" aria-label="Footer">
            {COLUMNS.map((c) => (
              <div key={c.title} className="ld-footer-col">
                <h3 className="ld-footer-h">{c.title}</h3>
                <ul>
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith('/') ? (
                        <Link href={l.href} className="ld-footer-link">
                          {l.label}
                        </Link>
                      ) : (
                        <a href={l.href} className="ld-footer-link">
                          {l.label}
                        </a>
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
