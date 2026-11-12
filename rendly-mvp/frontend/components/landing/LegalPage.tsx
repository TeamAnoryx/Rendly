'use client';

import React from 'react';
import Link from 'next/link';
import { LegalContentRenderer } from '@/components/legal/LegalContentRenderer';
import type { LegalSection } from '@/content/legalContent';
import SiteShell from './SiteShell';
import Reveal from './Reveal';

type LegalKind = 'terms' | 'privacy';

interface LegalPageProps {
  kind: LegalKind;
  title: string;
  effective: string;
  updated: string;
  sections: LegalSection[];
}

const TABS: ReadonlyArray<{ kind: LegalKind; href: string; label: string }> = [
  { kind: 'terms', href: '/terms', label: 'Terms of Service' },
  { kind: 'privacy', href: '/privacy', label: 'Privacy Policy' },
];

/** Full-page Terms / Privacy, rendered from the same content as the sign-up modals. */
export default function LegalPage({ kind, title, effective, updated, sections }: LegalPageProps) {
  return (
    <SiteShell>
      <section className="ld-legal" aria-labelledby="ld-legal-title">
        <div className="ld-container">
          <header className="ld-legal-head">
            <Reveal as="p" className="ld-eyebrow">
              Legal
            </Reveal>
            <Reveal as="h2" delay={60} className="ld-legal-title">
              <span id="ld-legal-title">{title}</span>
            </Reveal>
            <Reveal as="p" delay={100} className="ld-legal-meta">
              Effective {effective} · Last updated {updated}
            </Reveal>
          </header>
          <div className="ld-legal-layout">
            <nav className="ld-legal-aside" aria-label="Legal documents">
              {TABS.map((t) => (
                <Link
                  key={t.kind}
                  href={t.href}
                  className="ld-legal-tab"
                  aria-current={t.kind === kind ? 'page' : undefined}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
            <article className="ld-legal-body">
              <LegalContentRenderer sections={sections} />
            </article>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
