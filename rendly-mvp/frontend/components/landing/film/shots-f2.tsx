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
import { ease, lerp, rand, retyped, seg, type TypedLine } from './timeline';

const HEAD = 'Your people are out there.';
const PHONE_LINE = 'What brings you here?';

const IN0 = 11.3;
const SPIN0 = 12.8;
const SPIN1 = 14.3;
const TURN0 = 14.7;
const TURN1 = 15.7;
const OUT0 = 27.7;
const OUT1 = 28.75;
const SPIN_DEG = 5.5 * 360;

/* ---------------- Portrait screen ---------------- */

function PortraitUI() {
  const wrap: Animator = (t) => ({ o: seg(t, 11.72, 11.9) * (1 - seg(t, 13.9, 14.2)) });
  const ask: Animator = (t) => ({ text: PHONE_LINE.slice(0, Math.round(PHONE_LINE.length * seg(t, 12.0, 12.45))) });
  const card =
    (t0: number): Animator =>
    (t) => {
      const k = seg(t, t0, t0 + 0.35, ease.spring);
      return { s: 0.8 + 0.2 * k, o: Math.min(1, k * 2), y: (1 - k) * 20 };
    };
  return (
    <Fx as="span" anchor={false} className="fl-phone-ui" fx={wrap}>
      <span className="fl-phone-head">{HEAD}</span>
      <Fx as="span" anchor={false} className="fl-phone-ask" fx={ask} />
      <Fx as="span" anchor={false} className="fl-phone-card" fx={card(12.2)}>
        <Icon name="run" size={18} />
        Run club, Sundays
      </Fx>
      <Fx as="span" anchor={false} className="fl-phone-card" fx={card(12.34)}>
        <Icon name="globe" size={18} />
        Spanish swap
      </Fx>
      <Fx as="span" anchor={false} className="fl-phone-card" fx={card(12.48)}>
        <Icon name="music" size={18} />
        Weekend jam
      </Fx>
    </Fx>
  );
}

/* ---------------- Landscape app: 1. search ---------------- */

const LAND_LINES: readonly TypedLine[] = [
  { text: 'People to start a run club with', t0: 15.85, step: 0.035 },
  { text: 'Practice Spanish this week', t0: 17.15, step: 0.035 },
  { text: 'Jam with musicians nearby', t0: 18.4, step: 0.035 },
];

const SETS: ReadonlyArray<{ a: number; b: number; people: ReadonlyArray<readonly [string, string]> }> = [
  { a: 16.2, b: 17.05, people: [['Ana', '0.8 km'], ['Tom', '1.1 km'], ['Lin', '2 km'], ['Raj', '0.4 km'], ['Eli', '3 km'], ['Ivy', '1.6 km']] },
  { a: 17.5, b: 18.3, people: [['Lucía', '1.2 km'], ['Marco', '0.6 km'], ['Sofi', '2.4 km'], ['Ben', '0.9 km'], ['Ines', '1.8 km'], ['Pau', '3.1 km']] },
  { a: 18.75, b: 19.55, people: [['Kai', '0.7 km'], ['Noor', '1.3 km'], ['Jude', '2.2 km'], ['Ama', '0.5 km'], ['Ray', '2.8 km'], ['Mo', '1.4 km']] },
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
          set.people.map(([name, km], i) => {
            const tile: Animator = (t) => {
              const k = seg(t, set.a + i * 0.05, set.a + i * 0.05 + 0.4, ease.spring);
              const out = seg(t, set.b - 0.15 + i * 0.02, set.b + i * 0.02, ease.exit);
              return { s: 0.85 + 0.15 * k, o: Math.min(1, k * 2) * (1 - out), y: (1 - k) * 14 - out * 10 };
            };
            return (
              <Fx key={`${si}-${name}`} as="span" anchor={false} className="fl-land-tile" style={{ gridArea: `${1 + Math.floor(i / 3)} / ${1 + (i % 3)}` }} fx={tile}>
                <span className="fl-land-av" style={{ ['--hue' as string]: Math.round(rand(si * 11 + i) * 360) }}>
                  {name[0]}
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

const PINS: ReadonlyArray<readonly [number, number, string]> = [
  [-230, -60, 'Ana · Run club'],
  [210, -80, 'Lucía · Spanish'],
  [-160, 85, 'Kai · Weekend jam'],
  [235, 70, 'Noor · Climate talks'],
];

function NearbyMap() {
  const wrap: Animator = (t) => ({ o: seg(t, 19.55, 19.8) * (1 - seg(t, 23.4, 23.6)) });
  const lines: Animator = (t) => ({
    clip: `circle(${(seg(t, 20.0, 21.0, ease.std) * 75).toFixed(2)}% at 50% 50%)`,
    vars: { '--dash': (-t * 30).toFixed(1) },
  });
  const pulse =
    (d: number): Animator =>
    (t) => {
      const k = (((t - 19.7 + d) % 1.4) + 1.4) % 1.4 / 1.4;
      return { s: 1 + 3 * k, o: t < 19.7 ? 0 : 0.5 * (1 - k) };
    };
  const head: Animator = (t) => {
    const k = seg(t, 20.9, 21.3, ease.spring);
    return { s: 0.8 + 0.2 * k, o: Math.min(1, k * 2) };
  };
  return (
    <Fx as="span" anchor={false} className="fl-land-sec fl-land-map" fx={wrap}>
      <Fx as="span" anchor={false} className="fl-land-lines" fx={lines}>
        <svg viewBox="-368 -150 736 300" width="736" height="300" aria-hidden="true">
          <defs>
            <marker id="fl-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="rgba(255,255,255,0.85)" />
            </marker>
          </defs>
          {PINS.map(([x, y]) => (
            <path key={x} d={`M0 0 Q ${x * 0.5} ${y * 0.5 - 40} ${x * 0.86} ${y * 0.86}`} className="fl-land-path" markerEnd="url(#fl-arrowhead)" />
          ))}
        </svg>
      </Fx>
      <span className="fl-land-you">
        <Fx as="span" anchor={false} className="fl-land-ring" fx={pulse(0)} />
        <Fx as="span" anchor={false} className="fl-land-ring" fx={pulse(0.7)} />
        <span className="fl-land-me">You</span>
      </span>
      {PINS.map(([x, y, label], i) => {
        const pin: Animator = (t) => {
          const k = seg(t, 19.95 + i * 0.18, 20.35 + i * 0.18, ease.spring);
          const bob = Math.sin((t - i) * 2.4) * 3;
          return { x, y: y + bob * k, s: 0.4 + 0.6 * k, o: Math.min(1, k * 2) };
        };
        return (
          <Fx key={label} className="fl-land-pin" fx={pin}>
            <span className="fl-land-dotpin" style={{ ['--hue' as string]: Math.round(rand(i + 40) * 360) }}>
              {label[0]}
            </span>
            <span className="fl-land-pinlabel">{label}</span>
          </Fx>
        );
      })}
      <Fx className="fl-land-head" fx={head}>
        4 people near you share your why
      </Fx>
    </Fx>
  );
}

/* ---------------- Landscape app: 3. notifications and the button ---------------- */

const TOASTS: ReadonlyArray<readonly [number, IconName, string, string]> = [
  [23.8, 'bell', '3 people share your why', 'Run club · Spanish · Jam'],
  [24.35, 'heart', 'Ana is free on Sunday', '8:00 · Parque del Retiro'],
  [24.9, 'clock', 'Spanish swap tonight', '19:00 · 2 spots left'],
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
        <span className="fl-land-big">
          <Fx as="span" anchor={false} fx={count} />
          <span className="fl-land-bigsub">new matches</span>
        </span>
        <Fx as="span" anchor={false} className="fl-land-btn" fx={btn}>
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
        {TOASTS.map(([t0, icon, title, sub]) => {
          const toast: Animator = (t) => {
            const k = seg(t, t0, t0 + 0.5, ease.spring);
            return { x: (1 - k) * 260, o: Math.min(1, k * 2), blur: (1 - Math.min(1, k)) * 6 };
          };
          return (
            <Fx key={title} as="span" anchor={false} className="fl-land-toast" fx={toast}>
              <span className="fl-land-ticon">
                <Icon name={icon} size={18} />
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
    return {
      y: lerp(lerp(pick(L, 760, 900), pick(L, 60, 80), enter), 0, turn),
      rx: lerp(6, 4, turn) - 55 * out,
      ry: lerp(tilt, 8, turn) + SPIN_DEG * spin + 180 * turn - 140 * out,
      rz: lerp(-4, 90, turn) - 210 * out,
      s: lerp(pick(L, 1, 0.78), pick(L, 1.6, 1.05), turn) * (1 + 6 * out * out),
      o: seg(t, IN0, IN0 + 0.15) * (1 - seg(t, OUT1 - 0.25, OUT1)),
      vars: { '--pb': `${(speed * 9 + out * 10).toFixed(2)}px` },
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
