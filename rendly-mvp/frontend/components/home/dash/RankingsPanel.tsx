'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { LeaderboardRow } from '@/services/pointsApi';
import { Avatar } from '@/components/shell/AppShell';
import { Icon } from '@/components/shell/Icon';
import './rankings-panel.css';

const MAX_ROWS = 10;
const SKELETON_ROWS = 4;

type Props = { leaders: LeaderboardRow[] | null; meId: string | null; className?: string };

const TIERS = ['gold', 'silver', 'bronze'] as const;

function tierFor(rank: number): string {
  return rank >= 1 && rank <= TIERS.length ? TIERS[rank - 1] : 'plain';
}

function formatPoints(n: number): string {
  return n.toLocaleString('en-IN');
}

function handle(r: LeaderboardRow): string {
  return `@${r.username ?? 'someone'}`;
}

function Champion({ row, isMe }: { row: LeaderboardRow; isMe: boolean }) {
  return (
    <li className={`rk-champ${isMe ? ' rk-is-me' : ''}`} style={{ '--i': 0 } as CSSProperties}>
      <span className="rk-champ-halo" aria-hidden />
      <div className="rk-champ-avatar">
        <span className="rk-champ-ring" aria-hidden />
        <Avatar url={row.avatar_url} name={row.username} size="lg" />
        <span className="rk-champ-badge" aria-hidden>
          <Icon name="trophy" size={12} strokeWidth={2} />
        </span>
      </div>
      <div className="rk-champ-body">
        <span className="rk-champ-label">
          <span className="rk-champ-rank">No. 1</span>
          {isMe ? <span className="rk-you">You</span> : null}
        </span>
        <span className="rk-champ-name" title={handle(row)}>
          {handle(row)}
        </span>
        <span className="rk-champ-points">
          <span className="rk-num">{formatPoints(row.total)}</span>
          <span className="rk-unit">tokens</span>
        </span>
      </div>
    </li>
  );
}

function Row({ row, index, max, isMe }: { row: LeaderboardRow; index: number; max: number; isMe: boolean }) {
  const pct = max > 0 ? Math.max(0.04, Math.min(1, row.total / max)) : 0;
  const style = { '--i': index, '--pct': pct } as CSSProperties;
  return (
    <li className={`rk-row rk-tier-${tierFor(row.rank)}${isMe ? ' rk-is-me' : ''}`} style={style}>
      <span className="rk-rank rk-num">{String(row.rank).padStart(2, '0')}</span>
      <Avatar url={row.avatar_url} name={row.username} size="sm" />
      <div className="rk-row-body">
        <span className="rk-row-top">
          <span className="rk-name" title={handle(row)}>
            {handle(row)}
          </span>
          {isMe ? <span className="rk-you">You</span> : null}
          <span className="rk-points rk-num">{formatPoints(row.total)}</span>
        </span>
        <span className="rk-bar" aria-hidden>
          <span className="rk-bar-fill" />
        </span>
      </div>
    </li>
  );
}

export default function RankingsPanel({ leaders, meId, className }: Props) {
  const rows = leaders ? leaders.slice(0, MAX_ROWS) : null;
  const max = rows && rows.length ? Math.max(...rows.map((r) => r.total)) : 0;
  const [first, ...rest] = rows ?? [];

  return (
    <section className={`rk-panel${className ? ` ${className}` : ''}`} aria-labelledby="rk-title">
      <header className="rk-head">
        <div className="rk-head-text">
          <span className="rk-eyebrow">Leaderboard</span>
          <h2 id="rk-title" className="rk-title">
            Rankings
          </h2>
        </div>
        <Link href="/dashboard/profile#rankings" className="rk-details">
          Details <Icon name="arrow-right" size={13} />
        </Link>
      </header>

      {rows === null ? (
        <ol className="rk-list" aria-busy="true" aria-label="Loading rankings">
          <li className="rk-champ rk-champ--skel">
            <span className="rd-skeleton rk-skel-avatar" />
            <span className="rk-skel-stack">
              <span className="rd-skeleton rk-skel-line rk-skel-line--short" />
              <span className="rd-skeleton rk-skel-line" />
            </span>
          </li>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <li key={i} className="rk-row rk-row--skel">
              <span className="rd-skeleton rk-skel-dot" />
              <span className="rd-skeleton rk-skel-line" />
            </li>
          ))}
        </ol>
      ) : rows.length === 0 ? (
        <div className="rk-empty">
          <span className="rk-empty-icon" aria-hidden>
            <Icon name="trophy" size={20} />
          </span>
          <p>Rankings appear once Rendly Tokens are earned.</p>
        </div>
      ) : (
        <ol className="rk-list">
          <Champion row={first} isMe={first.user_id === meId} />
          {rest.map((r, i) => (
            <Row key={r.user_id} row={r} index={i + 1} max={max} isMe={r.user_id === meId} />
          ))}
        </ol>
      )}
    </section>
  );
}
