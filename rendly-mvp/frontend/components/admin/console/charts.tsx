'use client';

/** Small dependency-free SVG charts for the admin console (animated with CSS). */
import { useId, useState } from 'react';

interface SeriesPoint {
  label: string;
  values: number[];
}

interface AreaChartProps {
  points: SeriesPoint[];
  series: { name: string; color: string }[];
  height?: number;
  ariaLabel?: string;
}

const W = 720;

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Area chart with a hover read-out. The first series is filled, the others are lines. */
export function AreaChart({ points, series, height = 220, ariaLabel = 'Traffic over time' }: AreaChartProps) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 12, r: 12, b: 26, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...points.flatMap((p) => p.values)));
  const x = (i: number) => pad.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const paths = series.map((_, si) => {
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.values[si] ?? 0).toFixed(1)}`).join(' ');
    const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
    return { line, area };
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const slot = innerW / Math.max(1, points.length);

  return (
    <div className="ac-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={series[0]?.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ac-grid" />
            <text x={pad.l - 6} y={y(t) + 3} className="ac-axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={height - 8} className="ac-axis" textAnchor="middle">{p.label}</text>
          ) : null,
        )}
        {paths[0] && <path d={paths[0].area} fill={`url(#g${id})`} className="ac-area" />}
        {paths.map((p, si) => (
          <path key={si} d={p.line} fill="none" stroke={series[si].color} strokeWidth={si === 0 ? 2.2 : 1.6} className="ac-line" pathLength={1} />
        ))}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && points[hover] && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} className="ac-cursor" />
            {series.map((s, si) => (
              <circle key={si} cx={x(hover)} cy={y(points[hover].values[si] ?? 0)} r={3.5} fill={s.color} />
            ))}
          </g>
        )}
      </svg>
      <div className="ac-legend">
        {series.map((s, si) => (
          <span key={s.name}>
            <i style={{ background: s.color }} /> {s.name}
            {hover !== null && points[hover] ? <b>{points[hover].values[si] ?? 0}</b> : null}
          </span>
        ))}
        {hover !== null && points[hover] ? <span className="ac-legend-at">{points[hover].label}</span> : null}
      </div>
    </div>
  );
}

interface BarChartProps {
  values: number[];
  labels: string[];
  highlight?: number;
  low?: number;
  height?: number;
  ariaLabel: string;
}

/** Vertical bars that grow in; the peak and the lowest bar are coloured. */
export function BarChart({ values, labels, highlight, low, height = 150, ariaLabel }: BarChartProps) {
  const max = Math.max(1, ...values);
  return (
    <div className="bc-chart" style={{ height }} role="img" aria-label={ariaLabel}>
      {values.map((v, i) => (
        <div key={i} className="bc-col" title={`${labels[i]}: ${v}`}>
          <div
            className={`bc-bar ${i === highlight ? 'is-peak' : ''} ${i === low ? 'is-low' : ''}`}
            style={{ height: `${Math.max(2, (v / max) * 100)}%`, animationDelay: `${i * 18}ms` }}
          />
          <span className="bc-label">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

interface RankListProps {
  rows: { label: string; value: number; sub?: string }[];
  empty?: string;
}

/** Ranked rows with a proportional bar behind each. */
export function RankList({ rows, empty = 'No data yet' }: RankListProps) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="ac-empty">{empty}</p>;
  return (
    <ul className="rl-list">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="rl-row">
          <span className="rl-bar" style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 30}ms` }} />
          <span className="rl-label" title={r.label}>{r.label}</span>
          {r.sub && <span className="rl-sub">{r.sub}</span>}
          <span className="rl-value">{r.value.toLocaleString('en-GB')}</span>
        </li>
      ))}
    </ul>
  );
}

interface DonutProps {
  parts: { label: string; value: number; color: string }[];
  size?: number;
}

/** Donut for share-of-total breakdowns. */
export function Donut({ parts, size = 120 }: DonutProps) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const segments = parts.reduce<{ part: (typeof parts)[number]; len: number; start: number }[]>((acc, part) => {
    const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].len : 0;
    return [...acc, { part, len: total ? (part.value / total) * c : 0, start }];
  }, []);
  return (
    <div className="dn-wrap">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Share breakdown">
        <circle cx="50" cy="50" r={r} className="dn-track" />
        {segments.map(({ part, len, start }) => (
          <circle
            key={part.label}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={part.color}
            strokeWidth="12"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-start}
            transform="rotate(-90 50 50)"
            className="dn-seg"
          />
        ))}
        <text x="50" y="54" textAnchor="middle" className="dn-total">{total.toLocaleString('en-GB')}</text>
      </svg>
      <ul className="dn-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <b>{total ? Math.round((p.value / total) * 100) : 0}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
