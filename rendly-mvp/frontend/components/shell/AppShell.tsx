'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { auth } from '@/services/auth';
import { getMyPoints } from '@/services/pointsApi';
import { RendlyLockup, RendlyMark } from '@/components/brand/Brand';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';
import { Toasts } from './Toasts';
import './shell.css';

const POINTS_REFRESH_MS = 60_000;

type NavItem = { href: string; label: string; short?: string; icon: string; match: (p: string) => boolean };

const WORKSPACE: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', match: (p) => p === '/dashboard' },
  { href: '/dashboard/match', label: 'Spark', icon: 'spark', match: (p) => p.startsWith('/dashboard/match') },
  { href: '/dashboard/chat', label: 'Whispers', icon: 'chat', match: (p) => p.startsWith('/dashboard/chat') },
  { href: '/dashboard/huddles', label: 'Huddles', icon: 'huddle', match: (p) => p.startsWith('/dashboard/huddles') },
];

const PEOPLE: NavItem[] = [
  { href: '/dashboard/connections', label: 'Connections', icon: 'people', match: (p) => p.startsWith('/dashboard/connections') },
  { href: '/dashboard/calls', label: 'Calls', icon: 'phone', match: (p) => p.startsWith('/dashboard/calls') },
  { href: '/dashboard/profile', label: 'Profile', icon: 'user', match: (p) => p.startsWith('/dashboard/profile') },
];

const SETTINGS: NavItem = {
  href: '/dashboard/settings',
  label: 'Settings',
  icon: 'settings',
  match: (p) => p.startsWith('/dashboard/settings'),
};

/** Bottom tab bar on phones: the five most used destinations. */
const TABS: NavItem[] = [...WORKSPACE, PEOPLE[2]];

const ALL_NAV: NavItem[] = [...WORKSPACE, ...PEOPLE, SETTINGS];

function titleFor(pathname: string): string {
  return ALL_NAV.find((n) => n.match(pathname))?.label ?? 'Rendly';
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  return (
    <Link
      href={item.href}
      className={`rd-rail-item ${active ? 'rd-rail-item--active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={item.label}
    >
      <Icon name={item.icon} size={16} />
      <span className="rd-rail-label">{item.label}</span>
    </Link>
  );
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

  // 3D tilt for .rd-tilt cards: one delegated listener, rAF-throttled, fine pointers only,
  // and off when the user prefers reduced motion.
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let active: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.rd-tilt') as HTMLElement | null;
      if (el !== active) {
        reset(active);
        active = el;
      }
      if (!el || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
      });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      reset(active);
    };
  }, []);

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
      <div className="rd-shell">
        <nav className="rd-rail" aria-label="Main navigation">
          <Link href="/dashboard" className="rd-rail-logo" aria-label="Rendly home">
            <RendlyLockup className="shell-lockup" />
            <span className="rd-rail-logo-mark shell-collapsed-mark">
              <RendlyMark className="shell-mark" />
            </span>
          </Link>

          <div className="rd-rail-section">Workspace</div>
          {WORKSPACE.map((n) => (
            <RailLink key={n.href} item={n} pathname={pathname} />
          ))}

          <div className="rd-rail-section">People</div>
          {PEOPLE.map((n) => (
            <RailLink key={n.href} item={n} pathname={pathname} />
          ))}

          <div className="rd-rail-spacer" />

          <div className="rd-rail-foot">
            <RailLink item={SETTINGS} pathname={pathname} />
            <button type="button" className="rd-rail-item" onClick={logout} disabled={loggingOut} title="Log out">
              {loggingOut ? <span className="rd-spinner shell-rail-spinner" /> : <Icon name="logout" size={16} />}
              <span className="rd-rail-label">{loggingOut ? 'Logging out…' : 'Log out'}</span>
            </button>
          </div>
        </nav>

        <header className="rd-topbar">
          <div className="rd-topbar-title">
            <Link href="/dashboard" className="shell-crumb-home" aria-label="Rendly home">
              <RendlyMark className="shell-crumb-mark" />
            </Link>
            <span className="rd-topbar-crumb rd-hide-mobile">Rendly</span>
            <span className="rd-topbar-crumb shell-crumb-sep rd-hide-mobile" aria-hidden>
              /
            </span>
            <span className="shell-crumb-current">{titleFor(pathname)}</span>
          </div>
          <div className="rd-topbar-actions">
            <Link href="/dashboard/profile#rankings" className="rd-points" title="Your points">
              <Icon name="star" size={13} />
              <span>{points === null ? '—' : points.toLocaleString('en-IN')}</span>
            </Link>
            <NotificationBell />
            <Link href="/dashboard/profile" aria-label="Your profile" className="shell-avatar-link">
              <Avatar url={user?.avatar_url} name={user?.username} size="sm" />
            </Link>
            <button type="button" className="rd-icon-btn rd-only-mobile shell-touch" onClick={logout} aria-label="Log out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>

        <main className="rd-main">{children}</main>

        <nav className="rd-tabbar" aria-label="Main navigation">
          {TABS.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={active ? 'rd-tab--active' : ''}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={n.icon} size={20} />
                <span>{n.short ?? n.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <Toasts />
    </>
  );
}
