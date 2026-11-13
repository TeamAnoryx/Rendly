'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RendlyMark } from '@/components/brand/Brand';

const ITEMS = [
  { href: '/admin/dashboard', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/analytics', label: 'Analytics' },
] as const;

export default function AdminNav() {
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
    </nav>
  );
}
