'use client';

/** Chapters 4-5: Matching (radar + shuffled deck, a match locks in) and Meet (two profiles, "Say hello"). */

import React from 'react';
import { ELENA, MARCO } from './cast';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Chip, Cursor, KLine, pick, pop, type CursorKey } from './kit';
import { Face, Icon } from './primitives';
import { Face as Photo, type FaceName } from './faces';
import { CLICKS, clamp, ease, kf, seg } from './timeline';
import { withBasePath } from '@/lib/basePath';

export const YOU_IMG = withBasePath('/film/clips/laptop-pip.jpg');
export const JORDAN_IMG = withBasePath('/film/clips/call.jpg');

function Avatar({ src, className = '' }: { src: string; className?: string }) {
  return (
    <span className={`fl-avatar ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- still from the film's own footage */}
      <img src={src} alt="" draggable={false} decoding="async" />
    </span>
  );
}

/* ---------------- 4. Matching ---------------- */

const RADAR = (L: Layout) => pick(L, { x: -330, y: 40 }, { x: 0, y: -250 });
const DECK = (L: Layout) => pick(L, { x: 360, y: 30 }, { x: 0, y: 300 });

const FRONTS = [19.0, 19.6, 20.2] as const;
const LOCK = 20.6;

/* The orbit system: three tilted rings around You, decelerating to a stop at LOCK. */
const M_IN = 17.25; // starts after the logo's exit (played 77.0)
const ORB_R = [165, 250, 330] as const;
const ORB_W = [0.9, -0.62, 0.46] as const; // rad/s
const TILT = 0.42;
const SLOW_AT = 19.6;
const JORDAN_ANGLE = (-28 * Math.PI) / 180;

/** Integrated orbit progress: full speed, then an even slow-down to a stop at LOCK. */
function orbitClock(t: number): number {
  const d = LOCK - SLOW_AT;
  if (t <= SLOW_AT) return t;
  const u = Math.min(t, LOCK) - SLOW_AT;
  return SLOW_AT + u - (u * u) / (2 * d);
}
const angleAt = (orbit: number, a0: number, t: number) => a0 + ORB_W[orbit] * orbitClock(t);

interface OrbNode {
  orbit: 0 | 1 | 2;
  a0: number;
  face: FaceName | null; // null = Jordan
  pct: number;
}

const JORDAN_A0 = JORDAN_ANGLE - ORB_W[2] * orbitClock(LOCK);
const ORB_NODES: readonly OrbNode[] = [
  { orbit: 0, a0: 0, face: 'pov14', pct: 61 },
  { orbit: 0, a0: Math.PI, face: 'pov11', pct: 48 },
  { orbit: 1, a0: 0.7, face: 'pov2', pct: 55 },
  { orbit: 1, a0: 2.8, face: 'pov5', pct: 72 },
  { orbit: 1, a0: 4.9, face: 'pov15', pct: 66 },
  { orbit: 2, a0: JORDAN_A0 + 2.1, face: 'pov7', pct: 58 },
  { orbit: 2, a0: JORDAN_A0 + 4.2, face: 'pov1', pct: 69 },
  { orbit: 2, a0: JORDAN_A0, face: null, pct: 94 },
];

interface DeckCard {
  name: string;
  role: string;
  why: string;
  score: number;
  photo: React.ReactNode;
}

const DECK_CARDS: readonly DeckCard[] = [
  { name: MARCO.name, role: 'Product designer', why: 'Looking for a weekend running crew', score: 71, photo: <Face who={MARCO} /> },
  { name: ELENA.name, role: 'Policy researcher', why: 'Wants a Spanish practice partner', score: 82, photo: <Face who={ELENA} /> },
  { name: 'Jordan K.', role: 'ML engineer', why: 'Wants to meet people who care about the climate', score: 94, photo: <Avatar src={JORDAN_IMG} /> },
];

function OrbitNode({ n, i }: { n: OrbNode; i: number }) {
  const isMatch = n.face === null;
  const fx: Animator = (t, L) => {
    const c = RADAR(L);
    const sc = pick(L, 1, 0.8);
    const a = angleAt(n.orbit, n.a0, t);
    const depth = (Math.sin(a) + 1) / 2; // 0 back .. 1 front
    const k = seg(t, M_IN + 0.25 + i * 0.09, M_IN + 0.75 + i * 0.09, ease.spring);
    const dim = isMatch ? 0 : seg(t, LOCK, LOCK + 0.6, ease.std);
    const lock = isMatch ? seg(t, LOCK, LOCK + 0.6, ease.spring) : 0;
    const r = ORB_R[n.orbit] * sc * (1 + 0.12 * dim);
    return {
      x: c.x + Math.cos(a) * r,
      y: c.y + Math.sin(a) * r * TILT,
      s: (0.72 + 0.32 * depth) * (0.3 + 0.7 * k) * (1 + 0.35 * lock),
      o: clamp(k * 2) * (0.5 + 0.5 * depth) * (1 - 0.75 * dim),
      blur: dim * 3 + (1 - depth) * 1.2 * (1 - lock),
      vars: { '--lock': clamp(lock).toFixed(3) },
    };
  };
  const tag: Animator = (t) => {
    const k = seg(t, 18.3 + i * 0.14, 18.95 + i * 0.14, ease.outCubic);
    return { text: `${Math.round(n.pct * k)}%`, o: seg(t, 18.3 + i * 0.14, 18.45 + i * 0.14) };
  };
  return (
    <Fx className={`fl-mo-node${isMatch ? ' fl-mo-node--match' : ''}`} fx={fx}>
      <span className="fl-mo-face">{isMatch ? <Avatar src={JORDAN_IMG} /> : <Photo name={n.face as FaceName} />}</span>
      <Fx as="span" anchor={false} className="fl-mo-pct" fx={tag} />
    </Fx>
  );
}

/** Rings, the scan beam, You at the centre and the link that draws to the match. */
function OrbitCore() {
  const core: Animator = (t, L) => {
    const c = RADAR(L);
    const k = seg(t, M_IN, M_IN + 1, ease.inOutCubic);
    return { x: c.x, y: c.y, s: pick(L, 1, 0.8) * (0.7 + 0.3 * k), o: k, rz: (1 - k) * -12, vars: { '--dash': (-t * 24).toFixed(1) } };
  };
  const burst: Animator = (t, L) => {
    const c = RADAR(L);
    const k = seg(t, M_IN, M_IN + 1, ease.outCubic);
    return { x: c.x, y: c.y, s: 0.2 + 2.4 * k, o: t < M_IN ? 0 : 0.8 * (1 - k) };
  };
  const beam: Animator = (t, L) => {
    const c = RADAR(L);
    return { x: c.x, y: c.y, rz: (t - M_IN) * 150, o: seg(t, M_IN + 0.6, M_IN + 1.0) * (1 - seg(t, LOCK - 0.2, LOCK + 0.2)) };
  };
  const link: Animator = (t, L) => {
    const c = RADAR(L);
    return { x: c.x, y: c.y, s: pick(L, 1, 0.8), o: t < LOCK ? 0 : 1 - seg(t, 22.3, 22.6), vars: { '--draw': seg(t, LOCK + 0.1, LOCK + 0.6, ease.std).toFixed(3) } };
  };
  const spark: Animator = (t, L) => {
    const c = RADAR(L);
    const sc = pick(L, 1, 0.8);
    const k = ((t - LOCK - 0.6) % 1.1) / 1.1;
    const on = t > LOCK + 0.6 && t < 22.3;
    const jx = Math.cos(JORDAN_ANGLE) * ORB_R[2] * sc;
    const jy = Math.sin(JORDAN_ANGLE) * ORB_R[2] * sc * TILT;
    return { x: c.x + jx * k, y: c.y + jy * k, o: on ? Math.sin(Math.PI * k) : 0 };
  };
  const you: Animator = (t, L) => {
    const c = RADAR(L);
    const k = seg(t, M_IN + 0.2, M_IN + 0.8, ease.spring);
    return { x: c.x, y: c.y, s: pick(L, 1, 0.8) * (0.4 + 0.6 * k) * (1 + 0.03 * Math.sin(t * 4)), o: clamp(k * 2) };
  };
  const jx = Math.cos(JORDAN_ANGLE) * ORB_R[2];
  const jy = Math.sin(JORDAN_ANGLE) * ORB_R[2] * TILT;
  return (
    <>
      <Fx className="fl-mo-burst" fx={burst} />
      <Fx className="fl-mo-core" fx={core}>
        <svg viewBox="-340 -160 680 320" width="680" height="320" aria-hidden="true">
          {ORB_R.map((r) => (
            <ellipse key={r} cx="0" cy="0" rx={r} ry={r * TILT} className="fl-mo-ring" />
          ))}
        </svg>
      </Fx>
      <Fx className="fl-mo-beam" fx={beam} />
      <Fx className="fl-mo-linkwrap" fx={link}>
        <svg viewBox="-340 -160 680 320" width="680" height="320" aria-hidden="true">
          <defs>
            <linearGradient id="fl-mo-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8ab4f8" />
              <stop offset="1" stopColor="#e58fb6" />
            </linearGradient>
          </defs>
          <path pathLength={1} className="fl-mo-link" d={`M0 0 Q ${jx * 0.45} ${jy * 0.45 - 70} ${jx} ${jy}`} />
        </svg>
      </Fx>
      <Fx className="fl-mo-spark" fx={spark} />
      <Fx className="fl-mo-you" fx={you}>
        <Avatar src={YOU_IMG} />
        <span className="fl-mo-youlabel">You</span>
      </Fx>
    </>
  );
}

function DeckCardView({ c, j }: { c: DeckCard; j: number }) {
  const fx: Animator = (t, L) => {
    const p = DECK(L);
    const kin = seg(t, FRONTS[j] - 0.05, FRONTS[j] + 0.45, ease.std);
    let depth = 0;
    for (let k = j + 1; k < FRONTS.length; k++) depth += seg(t, FRONTS[k], FRONTS[k] + 0.45, ease.std);
    const gone = j < 2 ? seg(t, LOCK + 0.3, LOCK + 0.8, ease.exit) : 0;
    const lock = j === 2 ? seg(t, LOCK, LOCK + 0.5, ease.spring) : 0;
    return {
      x: p.x + (1 - kin) * 140,
      y: p.y - 28 * depth,
      rz: (1 - kin) * 5,
      s: (1 - 0.05 * depth) * (1 + 0.05 * lock),
      o: kin * (1 - 0.45 * clamp(depth)) * (1 - gone),
      blur: (1 - kin) * 6 + depth * 1.2,
    };
  };
  const score: Animator = (t) => ({ text: j === 2 ? `${Math.round(kf(t, [[LOCK - 0.2, 0], [LOCK + 0.7, c.score]], ease.outCubic))}%` : `${c.score}%` });
  return (
    <Fx className={`fl-card fl-deckcard${j === 2 ? ' fl-deckcard--match' : ''}`} fx={fx}>
      <span className="fl-deckcard-photo">{c.photo}</span>
      <span className="fl-deckcard-body">
        <span className="fl-deckcard-name">{c.name}</span>
        <span className="fl-deckcard-role">{c.role}</span>
        <span className="fl-deckcard-why">&ldquo;{c.why}&rdquo;</span>
      </span>
      <span className="fl-deckcard-score">
        <Fx as="span" anchor={false} fx={score} />
        <span className="fl-deckcard-label">match</span>
      </span>
    </Fx>
  );
}

export function ShotMatching() {
  const exit: Animator = (t) => {
    const q = seg(t, 22.4, 23.25, ease.inCubic);
    return { s: 1 + 0.18 * q, o: 1 - q, blur: q * 8 };
  };
  const bg: Animator = (t) => ({ o: seg(t, M_IN, M_IN + 0.8), vars: { '--drift': `${(Math.sin(t * 0.6) * 60).toFixed(1)}px` } });
  const ring: Animator = (t, L) => {
    const p = DECK(L);
    const k = seg(t, LOCK + 0.05, LOCK + 0.9, ease.outCubic);
    return { x: p.x, y: p.y, s: 1 + 0.12 * k, o: t < LOCK ? 0 : 0.7 * (1 - k) };
  };
  return (
    <Shot range={[16.9, 23.3]} fx={exit}>
      <Fx anchor={false} className="fl-full fl-gdark" fx={bg} />
      <KLine text="Matched on why, not on looks." t0={17.5} t1={23.3} className="fl-kicker" y={(L) => pick(L, -340, -520)} />
      <OrbitCore />
      {ORB_NODES.map((n, i) => (
        <OrbitNode key={i} n={n} i={i} />
      ))}
      {DECK_CARDS.map((c, j) => (
        <DeckCardView key={c.name} c={c} j={j} />
      ))}
      <Fx className="fl-lockring" fx={ring} />
      <Chip t0={LOCK + 0.7} anchor className="fl-chip--accent" x={(L) => DECK(L).x} y={(L) => DECK(L).y + 112}>
        <Icon name="spark" size={16} />
        Shared why
      </Chip>
    </Shot>
  );
}

/* ---------------- 5. Meet ---------------- */

const HELLO_Y = (L: Layout) => pick(L, 345, 330);
const CARD_Y = (L: Layout) => pick(L, -85, -160);

function helloPath(L: Layout): ReadonlyArray<CursorKey> {
  const y = HELLO_Y(L);
  return [
    [25.1, pick(L, 520, 330), y + 160],
    [25.95, 6, y],
    [26.8, 8, y + 4],
  ];
}

interface ProfileProps {
  side: -1 | 1;
  name: string;
  role: string;
  why: string;
  img: string;
}

function Profile({ side, name, role, why, img }: ProfileProps) {
  const fx: Animator = (t, L) => {
    const k = seg(t, 23.15, 24.2, ease.std);
    const q = seg(t, 26.3, 26.9, ease.exit);
    const home = pick(L, 250, 220);
    return {
      x: side * (home + (1 - k) * 560),
      y: CARD_Y(L),
      rz: side * (1 - k) * 6,
      o: seg(t, 23.15, 23.6) * (1 - q),
      blur: (1 - k) * 8,
    };
  };
  return (
    <Fx className="fl-card fl-profile" fx={fx}>
      <span className="fl-profile-photo">
        <Avatar src={img} />
      </span>
      <span className="fl-profile-name">{name}</span>
      <span className="fl-profile-role">{role}</span>
      <span className="fl-profile-why">&ldquo;{why}&rdquo;</span>
    </Fx>
  );
}

export function ShotMeet() {
  const link: Animator = (t, L) => ({
    y: CARD_Y(L),
    sx: seg(t, 24.1, 24.6, ease.std),
    o: 1 - seg(t, 26.3, 26.8),
  });
  const hello: Animator = (t, L) => {
    const p = pop(t, 25.0);
    const press = Math.max(0, 1 - Math.abs(t - CLICKS.hello) / 0.13);
    return { y: HELLO_Y(L), s: p.s * (1 - 0.08 * press), o: p.o * (1 - seg(t, 26.6, 27.0)), vars: { '--glow': seg(t, CLICKS.hello, CLICKS.hello + 0.4).toFixed(3) } };
  };
  return (
    <Shot range={[22.9, 27.2]}>
      <div className="fl-dots" />
      <Fx className="fl-link" fx={link} />
      <Profile side={-1} name="You" role="Product designer" why="Meet people who care about the climate" img={YOU_IMG} />
      <Profile side={1} name="Jordan K." role="ML engineer" why="Find climate people to talk with" img={JORDAN_IMG} />
      <Chip t0={24.4} t1={26.4} anchor className="fl-chip--accent fl-chip--lg" y={(L) => pick(L, 175, 120)}>
        <Icon name="spark" size={18} />
        Shared why · 94%
      </Chip>
      <Chip t0={24.7} t1={26.4} anchor y={(L) => pick(L, 250, 200)} x={(L) => pick(L, -90, -90)}>
        Climate
      </Chip>
      <Chip t0={24.85} t1={26.4} anchor y={(L) => pick(L, 250, 200)} x={(L) => pick(L, 92, 92)}>
        Both in Lisbon
      </Chip>
      <Fx className="fl-btn fl-btn--hello" fx={hello}>
        <Icon name="video" size={20} />
        Say hello
      </Fx>
      <Cursor path={helloPath} clicks={[CLICKS.hello]} range={[25.1, 26.85]} />
    </Shot>
  );
}
