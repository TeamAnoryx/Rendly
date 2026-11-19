'use client';

/**
 * The opening's phone (film time 11.3-28.75 s).
 *  11.3   rises in as the headline folds into its screen
 *  12.8   spins clockwise five and a half times and halts on its back
 *  14.7   one more turn shows the front while it rolls to landscape
 *  15.7   twelve seconds of the app: search -> nearby map -> notifications
 *  27.7   spins away diagonally anticlockwise, growing into the city footage
 */

import React from 'react';
import { RendlyMark } from '@/components/brand/Brand';
import { Fx, type Animator } from './engine';
import { pick } from './kit';
import { Icon, SparkMark, type IconName } from './primitives';
import { Face, faceAt } from './faces';
import { ease, lerp, played, retyped, seg, type TypedLine } from './timeline';

const HEAD = 'Your people are out there.';
const PHONE_LINE = 'What brings you here?';

const IN0 = 11.3;
const SPIN0 = 12.8;
const SPIN1 = 14.3;
const TURN0 = 14.7;
const TURN1 = 15.7;
const OUT0 = 27.7;
const OUT1 = 28.5;
const SPIN_DEG = 5.5 * 360;

/* ---------------- Portrait screen ---------------- */

/* Authored on the voice-over clock (played seconds): the warp stretches this beat to ~2.7 s. */
const P_IN = 12.3;
const STACK = [0, 1, 2, 3, 4] as const;
const PCARDS: ReadonlyArray<{ icon: IconName; title: string; sub: string; face: number; t0: number }> = [
  { icon: 'run', title: 'Run club, Sundays', sub: '12 near you', face: 1, t0: 13.25 },
  { icon: 'globe', title: 'Spanish swap', sub: '8 near you', face: 2, t0: 13.42 },
  { icon: 'music', title: 'Weekend jam', sub: '5 near you', face: 3, t0: 13.59 },
];
/** When the selection glow rests on each card; it settles on the last. */
const SEL_T = [13.95, 14.25, 14.55] as const;
const PICKED = 14.6;
const CARD_STEP = 90;

function PortraitUI() {
  const wrap: Animator = (t) => ({ o: seg(played(t), P_IN, P_IN + 0.25) * (1 - seg(t, 13.9, 14.2)) });
  const head: Animator = (t) => {
    const n = played(t);
    const k = seg(n, P_IN + 0.05, P_IN + 0.6, ease.outCubic);
    return { y: (1 - k) * 18, o: k, blur: (1 - k) * 5 };
  };
  const orb: Animator = (t) => {
    const n = played(t);
    return { x: Math.sin(n * 1.3) * 40, y: Math.cos(n * 0.9) * 30, s: 1 + 0.08 * Math.sin(n * 2) };
  };
  const counter: Animator = (t) => {
    const n = played(t);
    const k = seg(n, 12.7, 13.4, ease.outCubic);
    return { text: `+${(1.2 * k).toFixed(1)}k nearby`, o: seg(n, 12.7, 12.9), x: (1 - seg(n, 12.7, 13.0, ease.outCubic)) * 14 };
  };
  const ask: Animator = (t) => ({ text: PHONE_LINE.slice(0, Math.round(PHONE_LINE.length * seg(played(t), 12.9, 13.45))) });
  const glow: Animator = (t) => {
    const n = played(t);
    const i = n < SEL_T[1] ? 0 : n < SEL_T[2] ? 1 : 2;
    const k = seg(n, SEL_T[i] - 0.18, SEL_T[i], ease.inOutCubic);
    const pos = i === 0 ? 0 : lerp(i - 1, i, k);
    return { y: pos * CARD_STEP, o: seg(n, SEL_T[0] - 0.15, SEL_T[0]) };
  };
  return (
    <Fx as="span" anchor={false} className="fl-phone-ui fl-pui" fx={wrap}>
      <Fx as="span" anchor={false} className="fl-pui-orb" fx={orb} />
      <Fx as="span" anchor={false} className="fl-phone-head fl-pui-head" fx={head}>
        {HEAD}
      </Fx>
      <span className="fl-pui-stack">
        {STACK.map((i) => {
          const pop: Animator = (t) => {
            const k = seg(played(t), 12.45 + i * 0.09, 12.85 + i * 0.09, ease.spring);
            return { s: 0.3 + 0.7 * k, o: Math.min(1, k * 2), x: (1 - Math.min(1, k)) * -16 };
          };
          return (
            <Fx key={i} as="span" anchor={false} className="fl-pui-av" fx={pop}>
              <Face name={faceAt(i + 4)} />
            </Fx>
          );
        })}
        <Fx as="span" anchor={false} className="fl-pui-count" fx={counter} />
      </span>
      <span className="fl-pui-askrow">
        <SparkMark size={16} />
        <Fx as="span" anchor={false} className="fl-phone-ask" fx={ask} />
      </span>
      <span className="fl-pui-cards">
        <Fx as="span" anchor={false} className="fl-pui-glow" fx={glow} />
        {PCARDS.map((c, i) => {
          const card: Animator = (t) => {
            const n = played(t);
            const k = seg(n, c.t0, c.t0 + 0.45, ease.spring);
            const done = Math.min(1, k);
            const on = i === 2 ? seg(n, SEL_T[2] - 0.1, SEL_T[2] + 0.1) : Math.max(0, 1 - Math.abs(n - SEL_T[i]) / 0.25);
            return { x: (1 - done) * 120, o: Math.min(1, k * 2), rz: (1 - done) * 4, s: 1 + 0.03 * on, vars: { '--on': on.toFixed(3) } };
          };
          const check: Animator = (t) => {
            const k = seg(played(t), PICKED, PICKED + 0.3, ease.spring);
            return { s: 0.2 + 0.8 * k, o: Math.min(1, k * 2), rz: (1 - Math.min(1, k)) * -90 };
          };
          return (
            <Fx key={c.title} as="span" anchor={false} className="fl-phone-card fl-pui-card" fx={card}>
              <span className="fl-pui-photo">
                <Face name={faceAt(c.face)} />
                <span className="fl-pui-ico">
                  <Icon name={c.icon} size={13} />
                </span>
              </span>
              <span className="fl-pui-txt">
                <span className="fl-pui-title">{c.title}</span>
                <span className="fl-pui-sub">{c.sub}</span>
              </span>
              {i === 2 && (
                <Fx as="span" anchor={false} className="fl-pui-check" fx={check}>
                  <Icon name="check" size={16} />
                </Fx>
              )}
            </Fx>
          );
        })}
      </span>
    </Fx>
  );
}

/* ---------------- Landscape app: 1. search ---------------- */

const LAND_LINES: readonly TypedLine[] = [
  { text: 'People to start a run club with', t0: 15.85, step: 0.035 },
  { text: 'Practice Spanish this week', t0: 17.15, step: 0.035 },
  { text: 'Jam with musicians nearby', t0: 18.4, step: 0.035 },
];

/** people: [name, distance, face index in FACES] (faces match the names). */
const SETS: ReadonlyArray<{ a: number; b: number; people: ReadonlyArray<readonly [string, string, number]> }> = [
  { a: 16.2, b: 17.05, people: [['Ana', '0.8 km', 0], ['Tom', '1.1 km', 1], ['Lin', '2 km', 2], ['Raj', '0.4 km', 3], ['Eli', '3 km', 4], ['Ivy', '1.6 km', 6]] },
  { a: 17.5, b: 18.3, people: [['Lucía', '1.2 km', 9], ['Marco', '0.6 km', 5], ['Sofi', '2.4 km', 12], ['Ben', '0.9 km', 7], ['Ines', '1.8 km', 2], ['Pau', '3.1 km', 8]] },
  { a: 18.75, b: 19.55, people: [['Kai', '0.7 km', 11], ['Noor', '1.3 km', 9], ['Jude', '2.2 km', 4], ['Ama', '0.5 km', 0], ['Ray', '2.8 km', 1], ['Mo', '1.4 km', 10]] },
];

function Search() {
  const wrap: Animator = (t) => ({ o: seg(t, 15.6, 15.8) * (1 - seg(t, 19.45, 19.65)) });
  const field: Animator = (t) => ({ text: retyped(t, LAND_LINES) });
  return (
    <Fx as="span" anchor={false} className="fl-land-sec" fx={wrap}>
      <span className="fl-land-search">
        <SparkMark size={18} />
        <Fx as="span" anchor={false} className="fl-land-q" fx={field} />
        <span className="fl-caret" />
      </span>
      <span className="fl-land-grid">
        {SETS.map((set, si) =>
          set.people.map(([name, km, face], i) => {
            const tile: Animator = (t) => {
              const k = seg(t, set.a + i * 0.05, set.a + i * 0.05 + 0.4, ease.spring);
              const out = seg(t, set.b - 0.15 + i * 0.02, set.b + i * 0.02, ease.exit);
              return { s: 0.85 + 0.15 * k, o: Math.min(1, k * 2) * (1 - out), y: (1 - k) * 14 - out * 10 };
            };
            return (
              <Fx key={`${si}-${name}`} as="span" anchor={false} className="fl-land-tile" style={{ gridArea: `${1 + Math.floor(i / 3)} / ${1 + (i % 3)}` }} fx={tile}>
                <span className="fl-land-av fl-land-av--photo">
                  <Face name={faceAt(face)} />
                  <span className="fl-land-live" />
                </span>
                <span className="fl-land-name">{name}</span>
                <span className="fl-land-km">{km}</span>
              </Fx>
            );
          })
        )}
      </span>
    </Fx>
  );
}

/* ---------------- Landscape app: 2. nearby map ---------------- */

/** [x, y, name, why, km, face, match %] */
const PINS: ReadonlyArray<readonly [number, number, string, string, string, number, number]> = [
  [-232, -58, 'Ana', 'Run club', '0.8 km', 0, 96],
  [214, -74, 'Lucía', 'Spanish', '1.2 km', 2, 92],
  [-262, 64, 'Kai', 'Weekend jam', '0.7 km', 3, 94],
  [236, 74, 'Noor', 'Climate talks', '1.4 km', 6, 89],
];
const STREETS = [
  'M-420 -40 C -200 -90, 40 30, 420 -20',
  'M-420 70 C -150 40, 120 120, 420 60',
  'M-260 -170 C -220 -40, -280 60, -200 170',
  'M60 -170 C 20 -60, 110 40, 70 170',
  'M260 -170 C 300 -40, 220 60, 300 170',
  'M-420 -120 L 420 -140',
] as const;
const MAP_IN = 19.55;
const MAP_OUT = 23.4;

function NearbyMap() {
  const wrap: Animator = (t) => ({ o: seg(t, MAP_IN, MAP_IN + 0.25) * (1 - seg(t, MAP_OUT, MAP_OUT + 0.2)) });
  const streets: Animator = (t) => {
    const k = seg(t, MAP_IN, 21.2, ease.outCubic);
    return { s: lerp(1.35, 1.04, k) + 0.02 * Math.sin(t * 0.8), x: lerp(60, 0, k) + Math.sin(t * 0.5) * 8, y: lerp(-30, 0, k), rz: lerp(-6, 0, k) };
  };
  const radar: Animator = (t) => ({ rz: (t - MAP_IN) * 150, o: seg(t, 19.8, 20.2) * 0.9 });
  const lines: Animator = (t) => ({
    clip: `circle(${(seg(t, 20.1, 21.1, ease.std) * 75).toFixed(2)}% at 50% 50%)`,
    vars: { '--dash': (-t * 36).toFixed(1) },
  });
  const pulse =
    (d: number): Animator =>
    (t) => {
      const k = (((t - 19.7 + d) % 1.4) + 1.4) % 1.4 / 1.4;
      return { s: 1 + 3.4 * k, o: t < 19.7 ? 0 : 0.55 * (1 - k) };
    };
  const head: Animator = (t) => {
    const k = seg(t, 20.9, 21.35, ease.spring);
    return { s: 0.8 + 0.2 * k, o: Math.min(1, k * 2), y: (1 - Math.min(1, k)) * -12 };
  };
  const stat: Animator = (t) => {
    const k = seg(t, 21.9, 22.35, ease.spring);
    return { y: (1 - Math.min(1, k)) * 40, o: Math.min(1, k * 2) };
  };
  const statN: Animator = (t) => ({ text: String(Math.max(1, Math.round(4 * seg(t, 22.0, 22.6)))) });
  return (
    <Fx as="span" anchor={false} className="fl-land-sec fl-land-map fl-nm" fx={wrap}>
      <Fx as="span" anchor={false} className="fl-nm-streets" fx={streets}>
        <svg viewBox="-420 -170 840 340" width="840" height="340" aria-hidden="true">
          <path className="fl-nm-park" d="M-120 -150 C -40 -160, 20 -120, 0 -70 C -20 -30, -110 -40, -130 -90 Z" />
          <path className="fl-nm-water" d="M140 110 C 200 90, 300 110, 420 100 L 420 170 L 120 170 Z" />
          {STREETS.map((d) => (
            <path key={d} d={d} className="fl-nm-street" />
          ))}
        </svg>
      </Fx>
      <span className="fl-land-you">
        <Fx as="span" anchor={false} className="fl-nm-radar" fx={radar} />
      </span>
      <Fx as="span" anchor={false} className="fl-land-lines" fx={lines}>
        <svg viewBox="-368 -150 736 300" width="736" height="300" aria-hidden="true">
          <defs>
            <linearGradient id="fl-nm-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8ab4f8" />
              <stop offset="1" stopColor="#e58fb6" />
            </linearGradient>
          </defs>
          {PINS.map(([x, y]) => (
            <path key={x} d={`M0 0 Q ${x * 0.5} ${y * 0.5 - 40} ${x * 0.82} ${y * 0.82}`} className="fl-land-path fl-nm-path" />
          ))}
        </svg>
      </Fx>
      <span className="fl-land-you">
        <Fx as="span" anchor={false} className="fl-land-ring" fx={pulse(0)} />
        <Fx as="span" anchor={false} className="fl-land-ring" fx={pulse(0.7)} />
        <span className="fl-nm-me">
          <Face name="pov18" />
        </span>
      </span>
      {PINS.map(([x, y, name, why, km, face, pct], i) => {
        const pin: Animator = (t) => {
          const k = seg(t, 20.05 + i * 0.2, 20.5 + i * 0.2, ease.spring);
          const bob = Math.sin((t - i) * 2.4) * 3;
          return { x, y: y + bob * Math.min(1, k), s: 0.3 + 0.7 * k, o: Math.min(1, k * 2) };
        };
        const badge: Animator = (t) => {
          const k = seg(t, 21.4 + i * 0.12, 21.75 + i * 0.12, ease.spring);
          return { s: 0.4 + 0.6 * k, o: Math.min(1, k * 2), text: `${Math.round(pct * seg(t, 21.4 + i * 0.12, 22.0 + i * 0.12))}%` };
        };
        return (
          <Fx key={name} className="fl-land-pin fl-nm-pin" fx={pin}>
            <span className="fl-nm-face">
              <Face name={faceAt(face)} />
              <Fx as="span" anchor={false} className="fl-nm-pct" fx={badge} />
            </span>
            <span className="fl-nm-label">
              <b>{name}</b>
              <span>{why}</span>
              <i>{km}</i>
            </span>
          </Fx>
        );
      })}
      <Fx className="fl-land-head fl-nm-head" fx={head}>
        <SparkMark size={14} /> 4 people near you share your why
      </Fx>
      <Fx className="fl-nm-stat" fx={stat}>
        <Fx as="span" anchor={false} className="fl-nm-n" fx={statN} /> matches within 1.5 km
        <span className="fl-nm-bars">
          <span />
          <span />
          <span />
        </span>
      </Fx>
    </Fx>
  );
}

/* ---------------- Landscape app: 3. notifications and the button ---------------- */

/** [t0, icon, title, sub, face] */
const TOASTS: ReadonlyArray<readonly [number, IconName, string, string, number]> = [
  [23.8, 'bell', '3 people share your why', 'Run club · Spanish · Jam', 3],
  [24.35, 'heart', 'Ana is free on Sunday', '8:00 · Parque del Retiro', 0],
  [24.9, 'clock', 'Spanish swap tonight', '19:00 · 2 spots left', 2],
];
const CLICK = 26.45;

function Notifications() {
  const wrap: Animator = (t) => ({ o: seg(t, 23.55, 23.75) });
  const count: Animator = (t) => ({ text: String(Math.round(3 * seg(t, 23.9, 25.1))) });
  const btn: Animator = (t) => {
    const k = seg(t, 25.5, 25.9, ease.spring);
    const press = Math.max(0, 1 - Math.abs(t - CLICK) / 0.1);
    return { s: (0.7 + 0.3 * k) * (1 - 0.08 * press), o: Math.min(1, k * 2) };
  };
  const label: Animator = (t) => ({ o: 1 - seg(t, CLICK + 0.1, CLICK + 0.25) });
  const spin: Animator = (t) => ({ rz: (t - CLICK) * 520, o: seg(t, CLICK + 0.15, CLICK + 0.3) * (1 - seg(t, 26.95, 27.05)) });
  const check: Animator = (t) => {
    const k = seg(t, 27.0, 27.3, ease.spring);
    return { s: 0.4 + 0.6 * k, o: Math.min(1, k * 2) };
  };
  const ripple: Animator = (t) => {
    const k = seg(t, CLICK, CLICK + 0.6, ease.outCubic);
    return { s: 0.3 + 2.2 * k, o: t >= CLICK ? 0.45 * (1 - k) : 0 };
  };
  const cursor: Animator = (t) => {
    const k = seg(t, 25.7, 26.35, ease.std);
    const press = Math.max(0, 1 - Math.abs(t - CLICK) / 0.12);
    return { x: lerp(200, 0, k), y: lerp(120, 0, k), s: 1 - 0.15 * press, o: seg(t, 25.6, 25.8) };
  };
  return (
    <Fx as="span" anchor={false} className="fl-land-sec fl-land-notes" fx={wrap}>
      <span className="fl-land-left">
        <span className="fl-land-big fl-nt-big">
          <Fx as="span" anchor={false} className="fl-nt-num" fx={count} />
          <span className="fl-land-bigsub">new matches</span>
        </span>
        <span className="fl-nt-stack">
          {[3, 0, 2].map((f, i) => {
            const pop: Animator = (t) => {
              const k = seg(t, 24.0 + i * 0.4, 24.4 + i * 0.4, ease.spring);
              return { s: 0.3 + 0.7 * k, o: Math.min(1, k * 2) };
            };
            return (
              <Fx key={f} as="span" anchor={false} className="fl-nt-av" fx={pop}>
                <Face name={faceAt(f)} />
              </Fx>
            );
          })}
        </span>
        <Fx as="span" anchor={false} className="fl-land-btn fl-nt-btn" fx={btn}>
          <Fx as="span" anchor={false} className="fl-land-ripple" fx={ripple} />
          <Fx as="span" anchor={false} fx={label}>
            See your matches
          </Fx>
          <Fx as="span" anchor={false} className="fl-land-spin" fx={spin} />
          <Fx as="span" anchor={false} className="fl-land-check" fx={check}>
            <Icon name="check" size={20} />
          </Fx>
          <Fx as="span" anchor={false} className="fl-land-cursor" fx={cursor}>
            <svg width="22" height="26" viewBox="0 0 26 30" aria-hidden="true">
              <path d="M3 2.5v22.2c0 .9 1.1 1.3 1.7.7l5.2-5.4 3.7 8.3c.3.6 1 .9 1.6.6l2.6-1.2c.6-.3.9-1 .6-1.6l-3.7-8.2 7.4-.4c.9 0 1.3-1.1.6-1.7L4.7 1.8C4 1.2 3 1.6 3 2.5Z" fill="#fff" stroke="#0a0a0b" strokeWidth="1.4" />
            </svg>
          </Fx>
        </Fx>
      </span>
      <span className="fl-land-toasts">
        {TOASTS.map(([t0, icon, title, sub, face]) => {
          const toast: Animator = (t) => {
            const k = seg(t, t0, t0 + 0.5, ease.spring);
            const done = Math.min(1, k);
            return { x: (1 - k) * 260, o: Math.min(1, k * 2), blur: (1 - done) * 6, rz: (1 - done) * 3, vars: { '--shine': `${(-40 + 180 * seg(t, t0 + 0.3, t0 + 1.1)).toFixed(1)}%` } };
          };
          return (
            <Fx key={title} as="span" anchor={false} className="fl-land-toast fl-nt-toast" fx={toast}>
              <span className="fl-nt-face">
                <Face name={faceAt(face)} />
                <span className="fl-nt-ico">
                  <Icon name={icon} size={11} />
                </span>
              </span>
              <span className="fl-land-tbody">
                <span className="fl-land-ttitle">{title}</span>
                <span className="fl-land-tsub">{sub}</span>
              </span>
            </Fx>
          );
        })}
      </span>
    </Fx>
  );
}

function LandscapeUI() {
  const wrap: Animator = (t) => ({ o: seg(t, 15.3, 15.65) });
  return (
    <span className="fl-land">
      <Fx as="span" anchor={false} className="fl-land-in" fx={wrap}>
        <span className="fl-land-top">
          <RendlyMark className="fl-land-mark" />
          <span className="fl-land-title">Discover</span>
          <span className="fl-land-me-av">Y</span>
        </span>
        <Search />
        <NearbyMap />
        <Notifications />
      </Fx>
    </span>
  );
}

/* ---------------- The phone body ---------------- */

export function PhoneSpin() {
  const fx: Animator = (t, L) => {
    const enter = seg(t, IN0, IN0 + 0.65, ease.std);
    const spin = seg(t, SPIN0, SPIN1, ease.outCubic);
    const turn = seg(t, TURN0, TURN1, ease.inOutCubic);
    const out = seg(t, OUT0, OUT1, ease.inCubic);
    const tilt = lerp(26, 16, seg(t, IN0, SPIN0));
    const speed = Math.sin(Math.PI * seg(t, SPIN0, SPIN1)) * (1 - spin);
    // Exit: the phone lifts, tilts back and flies off up-right, leaving a dark frame for the city to iris into.
    const lift = seg(t, OUT0, OUT0 + 0.3, ease.outCubic);
    return {
      x: out * pick(L, 1100, 700),
      y: lerp(lerp(pick(L, 760, 900), pick(L, 60, 80), enter), 0, turn) - 30 * lift - out * pick(L, 260, 360),
      rx: lerp(6, 4, turn) + 18 * lift - 30 * out,
      ry: lerp(tilt, 8, turn) + SPIN_DEG * spin + 180 * turn - 50 * out,
      rz: lerp(-4, 90, turn) - 14 * lift + 30 * out,
      s: lerp(pick(L, 1, 0.78), pick(L, 1.6, 1.05), turn) * (1 + 0.04 * lift - 0.45 * out),
      blur: out * 8,
      o: seg(t, IN0, IN0 + 0.15) * (1 - seg(t, OUT1 - 0.3, OUT1)),
      vars: { '--pb': `${(speed * 9 + out * 6).toFixed(2)}px` },
    };
  };
  return (
    <Fx className="fl-phone3d" fx={fx}>
      <span className="fl-phone fl-phone-face">
        <span className="fl-phone-screen">
          <span className="fl-phone-bar">
            <span>9:41</span>
            <span className="fl-phone-dots" />
          </span>
          <PortraitUI />
          <LandscapeUI />
        </span>
      </span>
      <span className="fl-phone-back">
        <span className="fl-phone-cams">
          <span />
          <span />
          <span />
        </span>
        <RendlyMark className="fl-phone-backmark" />
      </span>
    </Fx>
  );
}
