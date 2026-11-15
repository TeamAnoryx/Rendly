'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import './stat-strip.css';

type LiveStats = { onlineUsers: number; lookingForMatch: number; avgMatchTimeMinutes: number };

interface StatStripProps {
  points: { total: number; rank: number | null } | null;
  liveCount: number;
  loading: boolean;
  stats: LiveStats | null;
  className?: string;
  /** Primary actions shown at the end of the bar (Host a huddle, Start a Spark). */
  actions?: React.ReactNode;
}

const COUNT_UP_MS = 1100;
const TOKEN_MILESTONE = 1000;
const HUDDLE_DOTS = 10;
const SPARK_MAX_POINTS = 24;
const MATCH_TIME_SCALE_MIN = 10;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Eases the displayed number from its previous value to `target`. */
function useCountUp(target: number | null): number | null {
  const [value, setValue] = useState<number | null>(target === null ? null : 0);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      return undefined;
    }
    const from = fromRef.current;
    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setValue(target);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - p, 4);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = target;
    };
  }, [target]);

  return value;
}

/** Rolling history of a live value, sampled each time it changes. */
function useHistory(value: number | null): number[] {
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (value === null) return;
    setHistory((prev) => [...prev, value].slice(-SPARK_MAX_POINTS));
  }, [value]);
  return history;
}

function fmt(n: number | null, decimals = 0): string {
  if (n === null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/* ---------- Visuals ---------- */

function Sparkline({ values }: { values: number[] }) {
  const w = 72;
  const h = 26;
  const pad = 2;
  const series = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = max === min ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  const [lx, ly] = pts[pts.length - 1];

  return (
    <svg className="ds-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id="ds-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ds-spark-fill)" />
      <path d={line} className="ds-spark-line" fill="none" />
      <circle cx={lx} cy={ly} r="2" className="ds-spark-head" />
      <circle cx={lx} cy={ly} r="2" className="ds-spark-ping" />
    </svg>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="ds-meter" role="presentation" title={label}>
      <span className="ds-meter-fill" style={{ transform: `scaleX(${clamp01(value)})` }} />
    </span>
  );
}

function DotGrid({ lit }: { lit: number }) {
  return (
    <span className="ds-dots" aria-hidden>
      {Array.from({ length: HUDDLE_DOTS }, (_, i) => (
        <span
          key={i}
          className={i < lit ? 'ds-dot ds-dot--on' : 'ds-dot'}
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

function Gauge({ fraction }: { fraction: number }) {
  const r = 13;
  const c = Math.PI * r; // half circle
  const f = clamp01(fraction);
  return (
    <svg className="ds-gauge" width="36" height="22" viewBox="0 0 36 22" aria-hidden>
      <path d="M5 19 A13 13 0 0 1 31 19" className="ds-gauge-track" fill="none" />
      <path
        d="M5 19 A13 13 0 0 1 31 19"
        className="ds-gauge-fill"
        fill="none"
        strokeDasharray={`${c} ${c}`}
        strokeDashoffset={c * (1 - f)}
      />
    </svg>
  );
}

/* ---------- Cell ---------- */

interface CellProps {
  index: number;
  icon: string;
  label: string;
  value: string;
  hint: React.ReactNode;
  visual?: React.ReactNode;
  href?: string;
  live?: boolean;
}

function Cell({ index, icon, label, value, hint, visual, href, live }: CellProps) {
  const body = (
    <>
      <span className="ds-glow" aria-hidden />
      <span className="ds-main">
        <span className="ds-label">
          <Icon name={icon} size={13} />
          {label}
          {live ? <span className="ds-live-dot" aria-hidden /> : null}
        </span>
        <span className="ds-value">{value}</span>
        <span className="ds-hint">{hint}</span>
      </span>
      {visual ? <span className="ds-visual">{visual}</span> : null}
      {href ? <Icon name="arrow-right" size={13} className="ds-go" /> : null}
    </>
  );
  const style = { '--ds-i': index } as React.CSSProperties;
  if (href) {
    return (
      <Link href={href} className="ds-cell ds-cell--link" style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div className="ds-cell" style={style}>
      {body}
    </div>
  );
}

/* ---------- Strip ---------- */

export default function StatStrip({ points, liveCount, loading, stats, className, actions }: StatStripProps) {
  const tokens = useCountUp(points ? points.total : null);
  const huddles = useCountUp(loading ? null : liveCount);
  const online = useCountUp(stats ? stats.onlineUsers : null);
  const avg = useCountUp(stats ? stats.avgMatchTimeMinutes : null);
  const onlineHistory = useHistory(stats ? stats.onlineUsers : null);

  const milestoneProgress = points ? (points.total % TOKEN_MILESTONE) / TOKEN_MILESTONE : 0;
  const nextMilestone = points ? (Math.floor(points.total / TOKEN_MILESTONE) + 1) * TOKEN_MILESTONE : 0;
  const lookingShare = stats && stats.onlineUsers > 0 ? stats.lookingForMatch / stats.onlineUsers : 0;
  const speed = stats ? 1 - Math.min(stats.avgMatchTimeMinutes, MATCH_TIME_SCALE_MIN) / MATCH_TIME_SCALE_MIN : 0;
  const avgDecimals = stats && !Number.isInteger(stats.avgMatchTimeMinutes) ? 1 : 0;

  return (
    <section className={['ds-root', actions ? 'ds-root--actions' : '', className].filter(Boolean).join(' ')} aria-label="Live overview">
      <span className="ds-badge" aria-hidden>
        <span className="ds-badge-dot" />
        Live
      </span>

      <Cell
        index={0}
        icon="coin"
        label="Rendly Tokens"
        value={fmt(tokens === null ? null : Math.round(tokens))}
        hint={points?.rank ? <>Rank <b>#{points.rank.toLocaleString('en-IN')}</b></> : points ? 'Unranked' : '—'}
        visual={
          points ? (
            <span className="ds-stack">
              <Meter value={milestoneProgress} label={`Progress to ${nextMilestone.toLocaleString('en-IN')}`} />
              <span className="ds-micro">to {nextMilestone.toLocaleString('en-IN')}</span>
            </span>
          ) : null
        }
        href="/dashboard/profile#rankings"
      />

      <Cell
        index={1}
        icon="huddle"
        label="Live huddles"
        value={fmt(huddles === null ? null : Math.round(huddles))}
        hint={loading ? '—' : liveCount ? 'Happening now' : 'None right now'}
        visual={loading ? null : <DotGrid lit={Math.min(liveCount, HUDDLE_DOTS)} />}
        href="/dashboard/huddles"
        live={!loading && liveCount > 0}
      />

      <Cell
        index={2}
        icon="activity"
        label="Online now"
        value={fmt(online === null ? null : Math.round(online))}
        hint={
          stats ? (
            <>
              <b>{stats.lookingForMatch.toLocaleString('en-IN')}</b> looking to match
            </>
          ) : (
            '—'
          )
        }
        visual={
          stats ? (
            <span className="ds-stack">
              <Sparkline values={onlineHistory} />
              <Meter value={lookingShare} label="Share looking to match" />
            </span>
          ) : null
        }
        live={!!stats}
      />

      <Cell
        index={3}
        icon="clock"
        label="Avg. match time"
        value={avg === null ? '—' : `~${fmt(avg, avgDecimals)}m`}
        hint="To find a Spark"
        visual={stats ? <Gauge fraction={speed} /> : null}
      />
    {actions ? <div className="ds-actions">{actions}</div> : null}
    </section>
  );
}
