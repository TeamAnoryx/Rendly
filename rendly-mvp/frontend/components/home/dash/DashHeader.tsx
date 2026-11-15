'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import './dash-header.css';

type LiveStats = { onlineUsers: number; lookingForMatch: number; avgMatchTimeMinutes: number };

interface DashHeaderProps {
  name: string;
  stats: LiveStats | null;
  className?: string;
}

const CLOCK_TICK_MS = 30_000;

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Re-renders on a slow tick so the greeting and clock stay current. */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'there') return 'there';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export default function DashHeader({ name, stats, className }: DashHeaderProps) {
  const now = useNow();
  const greeting = now ? greetingFor(now) : 'Welcome back';
  const displayName = formatName(name);

  return (
    <header className={['dh-root', className].filter(Boolean).join(' ')}>
      <div className="dh-copy">
        <p className="dh-eyebrow" aria-hidden={!now}>
          {now ? (
            <>
              <span>{formatDay(now)}</span>
              <span className="dh-sep" aria-hidden>
                ·
              </span>
              <span className="dh-mono">{formatTime(now)}</span>
            </>
          ) : (
            <span>&nbsp;</span>
          )}
        </p>
        <h1 className="dh-title">
          <span className="dh-greet">{greeting},</span> <span className="dh-name">{displayName}</span>
        </h1>
        <p className="dh-sub" aria-live="polite">
          {stats ? (
            <>
              <span className="dh-live" aria-hidden>
                <span className="dh-live-core" />
              </span>
              <span key={`o-${stats.onlineUsers}`} className="dh-num">
                {stats.onlineUsers.toLocaleString('en-IN')}
              </span>{' '}
              online now
              <span className="dh-sep" aria-hidden>
                ·
              </span>
              <span key={`l-${stats.lookingForMatch}`} className="dh-num">
                {stats.lookingForMatch.toLocaleString('en-IN')}
              </span>{' '}
              looking to match
            </>
          ) : (
            <span className="dh-sub-idle">Who will you meet today?</span>
          )}
        </p>
      </div>

    </header>
  );
}

/** The dashboard's two primary actions, rendered inside the stat bar. */
export function DashActions() {
  return (
    <>
      <Link href="/dashboard/huddles?create=1" className="dh-btn dh-btn--ghost">
        <Icon name="plus" size={14} />
        <span>Host a huddle</span>
      </Link>
      <Link href="/dashboard/match" className="dh-btn dh-btn--primary">
        <span className="dh-btn-sheen" aria-hidden />
        <Icon name="spark" size={14} />
        <span>Start a Spark</span>
        <Icon name="arrow-right" size={13} className="dh-btn-arrow" />
      </Link>
    </>
  );
}
