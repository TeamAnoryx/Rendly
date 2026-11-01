'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { auth } from '@/services/auth';
import { getMyPoints } from '@/services/pointsApi';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';
import { Toasts } from './Toasts';

const POINTS_REFRESH_MS = 60_000;

type NavItem = { href: string; label: string; icon: string; match: (p: string) => boolean };

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', match: (p) => p === '/dashboard' },
  { href: '/dashboard/match', label: 'Spark', icon: 'spark', match: (p) => p.startsWith('/dashboard/match') },
  { href: '/dashboard/chat', label: 'Whispers', icon: 'chat', match: (p) => p.startsWith('/dashboard/chat') },
  { href: '/dashboard/huddles', label: 'Huddles', icon: 'huddle', match: (p) => p.startsWith('/dashboard/huddles') },
  { href: '/dashboard/profile', label: 'Profile', icon: 'user', match: (p) => p.startsWith('/dashboard/profile') },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings', match: (p) => p.startsWith('/dashboard/settings') },
];

function titleFor(pathname: string): string {
  const item = [...NAV].reverse().find((n) => n.match(pathname));
  if (pathname.startsWith('/dashboard/connections')) return 'Connections';
  if (pathname.startsWith('/dashboard/calls')) return 'Calls';
  return item?.label ?? 'Rendly';
}

export function Avatar({
  url,
  name,
  size = 'md',
  online,
}: {
  url?: string | null;
  name?: string | null;
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
}) {
  const initials = (name ?? '?').replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span className={`rd-avatar ${size !== 'md' ? `rd-avatar--${size}` : ''}`}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
      {online !== undefined ? (
        <span className={`rd-presence ${online ? 'rd-presence--online' : ''}`} aria-label={online ? 'Online' : 'Offline'} />
      ) : null}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/dashboard';
  const router = useRouter();
  const { user } = useCurrentUser();
  const [points, setPoints] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadPoints = useCallback(async () => {
    try {
      const p = await getMyPoints();
      setPoints(p.total);
    } catch (err) {
      console.warn('[shell] points unavailable', err);
    }
  }, []);

  useEffect(() => {
    void loadPoints();
    const t = setInterval(() => void loadPoints(), POINTS_REFRESH_MS);
    const onPoints = () => void loadPoints();
    window.addEventListener('rendly:points-changed', onPoints);
    return () => {
      clearInterval(t);
      window.removeEventListener('rendly:points-changed', onPoints);
    };
  }, [loadPoints]);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await auth.logout();
      router.push('/login');
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <div className="rd-aurora" aria-hidden />
      <div className="rd-grid-overlay" aria-hidden />
      <div className="rd-shell">
        <nav className="rd-rail" aria-label="Main navigation">
          <Link href="/dashboard" className="rd-rail-logo" aria-label="Rendly home">
            <span className="rd-rail-logo-mark">R</span>
            <span className="rd-rail-label rd-gradient-text">Rendly</span>
          </Link>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rd-rail-item ${n.match(pathname) ? 'rd-rail-item--active' : ''}`}
              aria-current={n.match(pathname) ? 'page' : undefined}
              title={n.label}
            >
              <Icon name={n.icon} size={21} />
              <span className="rd-rail-label">{n.label}</span>
            </Link>
          ))}
          <div className="rd-rail-spacer" />
          <button type="button" className="rd-rail-item" onClick={logout} disabled={loggingOut} title="Log out">
            {loggingOut ? <span className="rd-spinner" /> : <Icon name="logout" size={21} />}
            <span className="rd-rail-label">{loggingOut ? 'Logging out…' : 'Log out'}</span>
          </button>
        </nav>

        <header className="rd-topbar">
          <div className="rd-topbar-title">{titleFor(pathname)}</div>
          <div className="rd-topbar-actions">
            <Link href="/dashboard/profile#rankings" className="rd-points" title="Your points">
              <Icon name="star" size={15} />
              {points === null ? '—' : points.toLocaleString('en-IN')}
            </Link>
            <NotificationBell />
            <Link href="/dashboard/profile" aria-label="Your profile">
              <Avatar url={user?.avatar_url} name={user?.username} />
            </Link>
            <button type="button" className="rd-icon-btn rd-only-mobile" onClick={logout} aria-label="Log out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>

        <main className="rd-main">{children}</main>

        <nav className="rd-tabbar" aria-label="Main navigation">
          {NAV.filter((n) => n.href !== '/dashboard/settings').map((n) => (
            <Link key={n.href} href={n.href} className={n.match(pathname) ? 'rd-tab--active' : ''} aria-label={n.label}>
              <Icon name={n.icon} size={22} />
            </Link>
          ))}
        </nav>
      </div>
      <Toasts />
    </>
  );
}
