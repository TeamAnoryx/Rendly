'use client';

import React from 'react';
import { ELENA, MARCO } from './cast';
import { Fx, Shot, type Animator } from './engine';
import { Face, Icon, SparkMark, Words, enter, type IconName } from './primitives';
import { ease, kf, lerp, rand, seg } from './timeline';

/* ---------------- Ambient light ---------------- */

/** One soft, slow light behind everything: blue-violet, never saturated. */
export function Ambient() {
  const fx: Animator = (t, L) => {
    const x = kf(t, [[0, 0], [11, -L.W * 0.12], [17, 0], [22, L.W * 0.08], [29, L.W * 0.14], [34, 0], [40, 0]]);
    const y = kf(t, [[0, -60], [11, 40], [17, -40], [29, -20], [40, -80]]);
    const s = kf(t, [[0, 0.9], [5, 1.05], [11, 1], [15, 1.15], [22, 1], [34, 0.95], [40, 1.1]]);
    const o = kf(t, [[0, 0.55], [14.5, 0.75], [16, 0.9], [22, 0.5], [34, 0.6], [38, 0.9], [40, 0.6]]);
    return { x, y, s, o };
  };
  return <Fx className="fl-ambient" fx={fx} />;
}

/* ---------------- 1. Know your why ---------------- */

export function ShotWhy() {
  const scene: Animator = (t) => {
    const { o, q } = enter(t, 0, 5.4, 0.01, 0.7);
    return { s: lerp(1, 1.035, seg(t, 0, 5.4)) + q * 0.04, o };
  };
  const ring = (i: number): Animator => (t) => {
    const k = seg(t, 0.2 + i * 0.25, 2.4 + i * 0.25, ease.std);
    return { s: 0.82 + k * 0.18 + seg(t, 0, 5.4) * 0.04 * (i + 1), o: k * (0.9 - i * 0.22) };
  };
  const sub: Animator = (t) => {
    const k = seg(t, 1.5, 2.6, ease.std);
    return { y: 230 + (1 - k) * 16, o: k };
  };
  return (
    <Shot range={[0, 5.4]} fx={scene}>
      {[0, 1, 2].map((i) => (
        <Fx key={i} className={`fl-ring fl-ring--${i}`} fx={ring(i)} />
      ))}
      <Fx className="fl-hero" fx={() => ({ y: -10 })}>
        <Words text="Know your why." t0={0.35} t1={4.75} size={150} accent={2} stagger={0.1} />
      </Fx>
      <Fx className="fl-sub" fx={sub}>
        Meet people who want what you want.
      </Fx>
    </Shot>
  );
}

/* ---------------- 2. Intent ---------------- */

const INTENT_TEXT = 'I want to build climate tools with a technical co-founder.';
const TYPE_A = 7.2;
const TYPE_B = 9.4;

const CHIPS: ReadonlyArray<{ label: string; icon: IconName }> = [
  { label: 'Co-founder', icon: 'rocket' },
  { label: 'Mentor', icon: 'users' },
  { label: 'Collaborator', icon: 'code' },
  { label: 'Climate', icon: 'leaf' },
];

export function ShotIntent() {
  const scene: Animator = (t) => {
    const { o, k } = enter(t, 4.8, 11.6, 0.9, 0.6);
    return { o, s: 0.97 + k * 0.03 + seg(t, 5, 11.6) * 0.02, y: (1 - k) * 30 };
  };
  const label: Animator = (t, L) => {
    const k = seg(t, 5.1, 6.1, ease.std);
    return { y: (L.portrait ? -230 : -170) + (1 - k) * 18, o: k };
  };
  const chips: Animator = (_t, L) => ({ y: L.portrait ? -110 : -70 });
  const chip = (i: number): Animator => (t) => {
    const k = seg(t, 5.5 + i * 0.08, 6.4 + i * 0.08, ease.std);
    return { y: (1 - k) * 14, o: k };
  };
  const bar: Animator = (t, L) => {
    const k = seg(t, 5.6, 6.6, ease.std);
    const press = seg(t, 9.75, 9.9) - seg(t, 9.9, 10.2);
    return { y: 60 + (1 - k) * 20, o: k, s: 1 - press * 0.006 };
  };
  const focus: Animator = (t) => ({ o: seg(t, 6.5, 7.1, ease.std) * (1 - seg(t, 10.2, 10.8)) });
  const typed: Animator = (t) => {
    const n = Math.round(seg(t, TYPE_A, TYPE_B) * INTENT_TEXT.length);
    return { text: INTENT_TEXT.slice(0, n) };
  };
  const placeholder: Animator = (t) => ({ o: t < TYPE_A ? 1 : 0 });
  const caret: Animator = (t) => {
    const on = t > 6.6 && t < 10 && (t > TYPE_A && t < TYPE_B ? 1 : Math.floor(t * 2.2) % 2 === 0 ? 1 : 0);
    return { o: on ? 1 : 0 };
  };
  const send: Animator = (t) => {
    const ready = seg(t, TYPE_B - 0.3, TYPE_B + 0.2, ease.std);
    const press = seg(t, 9.75, 9.88) - seg(t, 9.88, 10.25, ease.std);
    return { vars: { '--ready': ready.toFixed(3) }, s: 1 - press * 0.08 };
  };
  const hint: Animator = (t, L) => {
    const k = seg(t, 9.95, 10.7, ease.std);
    return { y: (L.portrait ? 200 : 170) + (1 - k) * 12, o: k * (1 - seg(t, 11, 11.5)) };
  };
  return (
    <Shot range={[4.8, 11.6]} fx={scene}>
      <Fx className="fl-ask" fx={label}>
        What brings you here?
      </Fx>
      <Fx className="fl-chips" fx={chips}>
        {CHIPS.map((c, i) => (
          <Fx key={c.label} as="span" anchor={false} className={`fl-chip${i === 0 ? ' is-picked' : ''}`} fx={chip(i)}>
            {i === 0 ? (
              <Fx as="span" anchor={false} className="fl-chip-check" fx={(t) => ({ s: seg(t, 6.55, 6.9, ease.std), o: seg(t, 6.55, 6.8) })}>
                <Icon name="check" size={18} />
              </Fx>
            ) : null}
            <Icon name={c.icon} size={18} />
            {c.label}
            {i === 0 ? <Fx as="span" anchor={false} className="fl-chip-fill" fx={(t) => ({ o: seg(t, 6.5, 6.9, ease.std) })} /> : null}
          </Fx>
        ))}
      </Fx>
      <Fx className="fl-prompt" fx={bar}>
        <Fx as="span" anchor={false} className="fl-prompt-ring" fx={focus} />
        <span className="fl-prompt-lead">
          <SparkMark size={26} />
        </span>
        <span className="fl-prompt-text">
          <Fx as="span" anchor={false} className="fl-prompt-ph" fx={placeholder}>
            Describe your why
          </Fx>
          <Fx as="span" anchor={false} className="fl-prompt-typed" fx={typed} />
          <Fx as="span" anchor={false} className="fl-caret" fx={caret} />
        </span>
        <Fx as="span" anchor={false} className="fl-send" fx={send}>
          <Icon name="send" size={22} />
        </Fx>
      </Fx>
      <Fx className="fl-hint" fx={hint}>
        <Icon name="spark" size={16} />
        Rendly matches on this, not on job titles.
      </Fx>
    </Shot>
  );
}

/* ---------------- 3. Matching ---------------- */

const DOTS = Array.from({ length: 42 }, (_, i) => ({
  a: rand(i) * Math.PI * 2,
  r: 260 + rand(i + 50) * 260,
  d: rand(i + 100) * 1.6,
  size: 2 + Math.round(rand(i + 150) * 3),
  hue: i % 5 === 0 ? 'v' : i % 3 === 0 ? 't' : 'b',
}));

const SHARED = ['Climate', 'Co-founder', 'Early stage'];

export function ShotMatching() {
  const scene: Animator = (t) => {
    const { o, k } = enter(t, 11, 17.6, 0.8, 0.6);
    return { o, s: 0.96 + k * 0.04 + seg(t, 11, 17.6) * 0.03 };
  };
  const center = (L: { portrait: boolean }) => (L.portrait ? -130 : -95);
  const status: Animator = (t, L) => {
    const k = seg(t, 11.3, 12.2, ease.std);
    return { y: (L.portrait ? -470 : -365) + (1 - k) * 14, o: k };
  };
  const statusA: Animator = (t) => ({ o: 1 - seg(t, 14.6, 14.9) });
  const statusB: Animator = (t) => ({ o: seg(t, 14.9, 15.3) });
  const arcs = (i: number): Animator => (t, L) => {
    const k = seg(t, 11.2 + i * 0.15, 12.4 + i * 0.15, ease.std);
    const settle = seg(t, 14.6, 15.8, ease.std);
    const spin = (t - 11) * (i % 2 ? -14 : 20) * (1 - settle * 0.7);
    return { y: center(L), rz: spin + i * 40, s: (0.85 + k * 0.15) * (1 - settle * 0.12), o: k * (1 - settle * 0.45) };
  };
  const me: Animator = (t, L) => {
    const k = seg(t, 11.4, 12.4, ease.std);
    const split = seg(t, 14.7, 15.7, ease.std);
    return { x: -split * 82, y: center(L), s: 0.9 + k * 0.1, o: k };
  };
  const them: Animator = (t, L) => {
    const k = seg(t, 14.7, 15.7, ease.std);
    return { x: k * 82, y: center(L), s: 0.8 + k * 0.2, o: k };
  };
  const link: Animator = (t, L) => {
    const k = seg(t, 15.2, 15.9, ease.std);
    return { y: center(L), s: 0.6 + k * 0.4, o: k };
  };
  const card: Animator = (t, L) => {
    const k = seg(t, 15.3, 16.2, ease.std);
    return { y: (L.portrait ? 270 : 278) + (1 - k) * 22, o: k };
  };
  const meter: Animator = (t) => {
    const k = seg(t, 15.6, 17, ease.std);
    return { vars: { '--fill': (k * 0.92).toFixed(4) } };
  };
  const pct: Animator = (t) => ({ text: `${Math.round(seg(t, 15.6, 17, ease.std) * 92)}%` });
  return (
    <Shot range={[11, 17.6]} fx={scene}>
      <Fx className="fl-status" fx={status}>
        <span className="fl-status-dot" />
        <span className="fl-status-stack">
          <Fx as="span" anchor={false} className="fl-status-line" fx={statusA}>
            Finding people who share your why
          </Fx>
          <Fx as="span" anchor={false} className="fl-status-line" fx={statusB}>
            One strong match
          </Fx>
        </span>
      </Fx>
      {DOTS.map((d, i) => (
        <Fx
          key={i}
          className={`fl-dot fl-dot--${d.hue}`}
          style={{ width: d.size, height: d.size }}
          fx={(t, L) => {
            const p = seg(t, 11 + d.d, 15 + d.d * 0.3, ease.inOutCubic);
            const r = d.r * (1 - p);
            const a = d.a + p * 2.2;
            const fade = seg(t, 11 + d.d * 0.4, 12 + d.d * 0.4) * (1 - seg(t, 14 + d.d * 0.3, 15 + d.d * 0.3));
            return { x: Math.cos(a) * r * 1.25, y: center(L) + Math.sin(a) * r * 0.9, o: fade * 0.9 };
          }}
        />
      ))}
      {[0, 1, 2].map((i) => (
        <Fx key={i} className={`fl-arc fl-arc--${i}`} fx={arcs(i)}>
          <svg viewBox="0 0 400 400" aria-hidden="true">
            <defs>
              <linearGradient id={`fl-arc-g${i}`} x1="0" y1="0" x2="400" y2="400" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={i === 2 ? '#78D9EC' : '#8AB4F8'} />
                <stop offset="1" stopColor="#C58AF9" />
              </linearGradient>
            </defs>
            <circle cx="200" cy="200" r="198" className="fl-arc-track" />
            <circle
              cx="200"
              cy="200"
              r="198"
              className="fl-arc-stroke"
              stroke={`url(#fl-arc-g${i})`}
              strokeDasharray={`${[260, 180, 120][i]} 1244`}
            />
          </svg>
        </Fx>
      ))}
      <Fx className="fl-orb" fx={me}>
        <Face who={MARCO} />
      </Fx>
      <Fx className="fl-orb" fx={them}>
        <Face who={ELENA} />
      </Fx>
      <Fx className="fl-orb-link" fx={link}>
        <SparkMark size={22} />
      </Fx>
      <Fx className="fl-meter-card" fx={card}>
        <div className="fl-meter-head">
          <span>Shared why</span>
          <Fx as="span" anchor={false} className="fl-meter-pct" fx={pct} />
        </div>
        <Fx anchor={false} className="fl-meter" fx={meter}>
          <i />
        </Fx>
        <div className="fl-meter-tags">
          {SHARED.map((s) => (
            <span key={s} className="fl-tag">
              {s}
            </span>
          ))}
        </div>
      </Fx>
    </Shot>
  );
}
