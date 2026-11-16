'use client';

/** Chapters 4-5: Matching (radar + shuffled deck, a match locks in) and Meet (two profiles, "Say hello"). */

import React from 'react';
import { ELENA, MARCO } from './cast';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Chip, Cursor, KLine, pick, pop, type CursorKey } from './kit';
import { Face, Icon } from './primitives';
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

const RADAR = (L: Layout) => pick(L, { x: -340, y: 30 }, { x: 0, y: -250 });
const DECK = (L: Layout) => pick(L, { x: 330, y: 30 }, { x: 0, y: 300 });

/** Nodes on the radar: [angle deg, radius px, initials | null]. */
const NODES: ReadonlyArray<readonly [number, number, string]> = [
  [-60, 125, 'AK'],
  [20, 200, ''],
  [110, 130, 'TR'],
  [160, 205, 'NS'],
  [215, 128, ''],
  [-120, 210, 'JM'],
  [65, 210, 'JK'],
];

const FRONTS = [19.0, 19.6, 20.2] as const;
const LOCK = 20.6;

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

function RadarNode({ i }: { i: number }) {
  const [ang, r, label] = NODES[i];
  const isMatch = label === 'JK';
  const fx: Animator = (t, L) => {
    const c = RADAR(L);
    const a = (ang * Math.PI) / 180;
    const sc = pick(L, 1, 0.82);
    const p = pop(t, 17.35 + i * 0.13);
    const dim = isMatch ? 0 : seg(t, LOCK, LOCK + 0.5);
    const lock = isMatch ? seg(t, LOCK, LOCK + 0.6, ease.std) : 0;
    return {
      x: c.x + Math.cos(a) * r * sc,
      y: c.y + Math.sin(a) * r * sc,
      s: p.s * (1 + 0.25 * lock),
      o: p.o * (1 - 0.65 * dim),
      vars: { '--lock': lock.toFixed(3) },
    };
  };
  const face =
    i === 1 ? <Face who={MARCO} /> : i === 4 ? <Face who={ELENA} /> : isMatch ? <Avatar src={JORDAN_IMG} /> : null;
  return (
    <Fx className={`fl-node${isMatch ? ' fl-node--match' : ''}`} fx={fx}>
      {face ?? <span className="fl-node-initials">{label}</span>}
    </Fx>
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
  const radar: Animator = (t, L) => {
    const c = RADAR(L);
    const k = seg(t, 16.9, 17.8, ease.std);
    return { x: c.x, y: c.y, s: pick(L, 1, 0.82) * (0.85 + 0.15 * k), o: k, vars: { '--sweep': `${(t * 110) % 360}deg` } };
  };
  const ring: Animator = (t, L) => {
    const p = DECK(L);
    const k = seg(t, LOCK + 0.05, LOCK + 0.9, ease.outCubic);
    return { x: p.x, y: p.y, s: 1 + 0.12 * k, o: t < LOCK ? 0 : 0.7 * (1 - k) };
  };
  return (
    <Shot range={[16.9, 23.3]} fx={exit}>
      <div className="fl-dots" />
      <KLine text="Matched on why, not on looks." t0={17.5} t1={23.3} className="fl-kicker" y={(L) => pick(L, -340, -520)} />
      <Fx className="fl-radar" fx={radar}>
        <span className="fl-radar-ring fl-radar-ring--1" />
        <span className="fl-radar-ring fl-radar-ring--2" />
        <span className="fl-radar-ring fl-radar-ring--3" />
        <span className="fl-radar-sweep" />
        <Avatar src={YOU_IMG} className="fl-radar-you" />
      </Fx>
      {NODES.map((_, i) => (
        <RadarNode key={i} i={i} />
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
