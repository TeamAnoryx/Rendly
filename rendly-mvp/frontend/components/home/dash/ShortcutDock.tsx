'use client';

import React from 'react';
import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import './shortcut-dock.css';

interface Shortcut {
  href: string;
  icon: string;
  title: string;
  hint: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { href: '/dashboard/chat', icon: 'chat', title: 'Whispers', hint: 'Chat and call your connections' },
  { href: '/dashboard/connections', icon: 'people', title: 'Connections', hint: 'Requests and people you know' },
  { href: '/dashboard/calls', icon: 'phone', title: 'Calls', hint: 'Your recent calls' },
];

/** Compact monochrome dock of quick links (replaces the old "Shortcuts" panel). */
export default function ShortcutDock({ className }: { className?: string }) {
  return (
    <nav className={className ? `sd-dock ${className}` : 'sd-dock'} aria-label="Shortcuts">
      <ul className="sd-list">
        {SHORTCUTS.map((s) => (
          <li key={s.href} className="sd-cell">
            <Link href={s.href} className="sd-item">
              <span className="sd-sheen" aria-hidden />
              <span className="sd-icon" aria-hidden>
                <Icon name={s.icon} size={17} />
              </span>
              <span className="sd-copy">
                <span className="sd-title">{s.title}</span>
                <span className="sd-hint">{s.hint}</span>
              </span>
              <span className="sd-arrow" aria-hidden>
                <Icon name="arrow-right" size={14} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { ShortcutDock };
