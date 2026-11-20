'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RendlyMark } from '@/components/brand/Brand';

const ITEMS = [
  { href: '/admin/dashboard', label: 'Overview' },
  { href: '/admin/queries', label: 'User queries' },
  { href: '/admin/health', label: 'Health & security' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/moderation', label: 'Moderation' },
] as const;

interface AdminNavProps {
  email?: string;
  onSignOut?: () => void;
}

export default function AdminNav({ email, onSignOut }: AdminNavProps) {
  const pathname = usePathname() ?? '';
  return (
    <nav className="adm-nav" aria-label="Admin">
      <Link href="/admin/dashboard" className="adm-brand" aria-label="Rendly admin">
        <RendlyMark />
        <span>Rendly Admin</span>
      </Link>
      <p className="adm-nav-label">Console</p>
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="adm-nav-item"
          aria-current={pathname.startsWith(it.href) ? 'page' : undefined}
        >
          {it.label}
        </Link>
      ))}
      {email && (
        <div className="adm-nav-foot">
          <span title={email}>{email}</span>
          {onSignOut && (
            <button type="button" className="ad-btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
