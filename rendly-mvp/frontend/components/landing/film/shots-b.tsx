'use client';

/**
 * Chapter 5: Intent (29-37.6 s, film time). She sits at her laptop; the
 * Rendly composer retypes a few reasons people connect, then her own why.
 * A light traces the composer's border, suggestions float up, small icon
 * badges pop, a location chip and an attachment drop in, she picks an
 * intent and presses Find my who, which morphs into a spinner and a check.
 */

import React from 'react';
import { Clip } from './clips';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Chip, Cursor, insetWipe, pick, pop, rise, type CursorKey } from './kit';
import { Icon, SparkMark, type IconName } from './primitives';
import { CLICKS, COMPOSER_LINES, PROMPT, clamp, ease, lerp, retyped, seg, typedEnd } from './timeline';

const A = 29;
const B = 37.6;
const CARD_IN = 30.0;
const OUT = 36.95;

/** Composer card centre, and the click targets inside it (canvas px from centre). */
const CARD = (L: Layout) => pick(L, { x: 330, y: 30 }, { x: 0, y: 250 });
const CHIP_AT = (L: Layout) => pick(L, { x: 92, y: 82 }, { x: -306, y: 302 });
const BTN_AT = (L: Layout) => pick(L, { x: 527, y: 201 }, { x: 267, y: 421 });

const INTENTS = ['Friends', 'Learn', 'Build', 'Hobbies', 'Mentor', 'Hiring', 'Collaborate'] as const;

function cursorPath(L: Layout): ReadonlyArray<CursorKey> {
  const c = CHIP_AT(L);
  const b = BTN_AT(L);
  const start = pick(L, { x: 700, y: 420 }, { x: 380, y: 560 });
  return [
    [33.5, start.x, start.y],
    [34.15, c.x, c.y],
    [34.75, c.x, c.y],
    [35.4, b.x, b.y],
    [36.6, b.x + 10, b.y + 6],
  ];
}

/* ---------------- Floating suggestions and icon badges ---------------- */

interface Suggestion {
  label: string;
  icon: IconName;
  x: number;
  y: number;
  t0: number;
}

const SUGGESTIONS: readonly Suggestion[] = [
  { label: 'Run club', icon: 'run', x: -560, y: -230, t0: 30.4 },
  { label: 'Study buddy', icon: 'book', x: -380, y: -120, t0: 30.6 },
  { label: 'Music jam', icon: 'music', x: -610, y: 10, t0: 30.8 },
  { label: 'Spanish swap', icon: 'globe', x: -420, y: 140, t0: 31.0 },
];

function Floater({ s }: { s: Suggestion }) {
  const fx: Animator = (t, L) => {
    const p = pop(t, s.t0, 0.5);
    const q = seg(t, 33.0, 33.5, ease.exit);
    const bob = Math.sin((t - s.t0) * 2.2 + s.x) * 8;
    const px = pick(L, s.x, s.x * 0.55);
    const py = pick(L, s.y, s.y - 300);
    return { x: px, y: py + bob - (t - s.t0) * 6, s: p.s * (1 - 0.2 * q), o: p.o * (1 - q), blur: q * 6 };
  };
  return (
    <Fx className="fl-float" fx={fx}>
      <Icon name={s.icon} size={18} />
      {s.label}
    </Fx>
  );
}

interface Badge {
  icon: IconName;
  dx: number;
  dy: number;
  t0: number;
}

const BADGES: readonly Badge[] = [
  { icon: 'bell', dx: 300, dy: -215, t0: 31.1 },
  { icon: 'pin', dx: -330, dy: -40, t0: 33.05 },
  { icon: 'heart', dx: 305, dy: 120, t0: 34.55 },
];

function PopBadge({ b }: { b: Badge }) {
  const fx: Animator = (t, L) => {
    const c = CARD(L);
    const p = pop(t, b.t0, 0.45);
    const q = seg(t, b.t0 + 1.1, b.t0 + 1.4, ease.exit);
    return { x: c.x + b.dx * pick(L, 1, 1.15), y: c.y + b.dy, s: p.s * (1 - 0.5 * q), o: p.o * (1 - q), rz: (1 - p.s) * 30 };
  };
  return (
    <Fx className="fl-badge" fx={fx}>
      <Icon name={b.icon} size={18} />
    </Fx>
  );
}

/* ---------------- Composer ---------------- */

function TracedBorder() {
  return (
    <>
      <span className="fl-trace" />
      <span className="fl-trace fl-trace--glow" />
    </>
  );
}

function FindButton() {
  const fx: Animator = (t) => {
    const press = Math.max(0, 1 - Math.abs(t - CLICKS.find) / 0.13);
    const morph = seg(t, CLICKS.find + 0.08, CLICKS.find + 0.4, ease.std);
    const done = seg(t, 36.35, 36.55, ease.std);
    return {
      s: (1 - 0.07 * press) * (1 + 0.12 * Math.sin(clamp((t - 36.35) / 0.3) * Math.PI)),
      vars: { '--morph': morph.toFixed(3), '--done': done.toFixed(3) },
    };
  };
  const spin: Animator = (t) => ({ rz: (t - CLICKS.find) * 540, o: seg(t, CLICKS.find + 0.25, CLICKS.find + 0.4) * (1 - seg(t, 36.3, 36.4)) });
  return (
    <Fx as="span" anchor={false} className="fl-btn fl-btn--find fl-btn--morph" fx={fx}>
      <span className="fl-btn-label">
        Find my who
        <Icon name="arrow" size={18} />
      </span>
      <Fx as="span" anchor={false} className="fl-btn-spin" fx={spin} />
      <span className="fl-btn-done">
        <Icon name="check" size={22} />
      </span>
      <TracedBorder />
    </Fx>
  );
}

function Composer() {
  const card: Animator = (t, L) => {
    const p = CARD(L);
    const r = rise(t, CARD_IN, 99, 60, 0.9);
    const zoom = seg(t, OUT, B, ease.inCubic);
    return {
      x: p.x,
      y: p.y + (r.y ?? 0),
      o: (r.o ?? 1) * (1 - zoom),
      blur: (r.blur ?? 0) + zoom * 8,
      s: 1 + zoom * 0.4,
      vars: { '--ang': (((t - CARD_IN) * 160) % 360).toFixed(1), '--trace': seg(t, CARD_IN + 0.3, CARD_IN + 0.9).toFixed(3) },
    };
  };
  const field: Animator = (t) => ({ text: retyped(t, COMPOSER_LINES) });
  const caret: Animator = (t) => {
    const end = typedEnd(PROMPT);
    return { o: t < 30.3 || t > end + 0.8 ? 0 : t < end ? 1 : Math.floor(t * 2.4) % 2 === 0 ? 1 : 0 };
  };
  const chipSel: Animator = (t) => {
    const p = pop(t, 33.3);
    const sel = seg(t, CLICKS.chip, CLICKS.chip + 0.25, ease.std);
    const press = Math.max(0, 1 - Math.abs(t - CLICKS.chip) / 0.12);
    return { s: p.s * (1 - 0.06 * press) * (1 + 0.08 * Math.sin(clamp((t - CLICKS.chip) / 0.3) * Math.PI)), o: p.o, vars: { '--sel': sel.toFixed(3) } };
  };
  return (
    <Fx className="fl-card fl-composer" fx={card}>
      <TracedBorder />
      <div className="fl-composer-head">
        <SparkMark size={26} />
        <span className="fl-composer-title">What&apos;s your why?</span>
        <span className="fl-composer-meta">Rendly</span>
      </div>
      <div className="fl-field">
        <span>
          <Fx as="span" anchor={false} fx={field} />
          <Fx as="span" anchor={false} className="fl-caret" fx={caret} />
        </span>
        <span className="fl-field-tools">
          <Chip t0={33.15} className="fl-chip--sm fl-chip--loc">
            <Icon name="pin" size={14} />
            Lisbon
          </Chip>
          <Chip t0={33.35} className="fl-chip--sm fl-chip--icon">
            <Icon name="clip" size={15} />
          </Chip>
        </span>
      </div>
      <div className="fl-label">I&apos;m here for</div>
      <div className="fl-chiprow fl-chiprow--wrap">
        <Fx as="span" anchor={false} className="fl-chip fl-chip--select fl-chip--sm" fx={chipSel}>
          <span className="fl-chip-check">
            <Icon name="check" size={14} />
          </span>
          {INTENTS[0]}
        </Fx>
        {INTENTS.slice(1).map((label, i) => (
          <Chip key={label} t0={33.42 + i * 0.09} className="fl-chip--sm">
            {label}
          </Chip>
        ))}
      </div>
      <div className="fl-composer-foot">
        <span className="fl-hint">Only your why is shared, never your feed.</span>
        <FindButton />
      </div>
    </Fx>
  );
}

export function ShotIntent() {
  // In: a tilted card swings round to face us and opens to full frame under a light sweep.
  // Out: the frame folds back into a card, turns away and slides off left.
  const footage: Animator = (t, L) => {
    const k = seg(t, A + 0.05, A + 1.35, ease.inOutCubic);
    const q = seg(t, OUT - 0.35, B - 0.1, ease.inCubic);
    const card = Math.max(k * (1 - q), 0);
    return {
      clip: insetWipe(card, pick(L, 620, 520), pick(L, 350, 640), L.W, L.H, 28, 0),
      rx: (1 - k) * 14 - q * 6,
      ry: (1 - k) * -28 + q * 32,
      rz: (1 - k) * -3,
      x: -q * pick(L, 520, 240),
      s: lerp(0.82, 1, k) * (1 - 0.22 * q),
      bright: 0.6 + 0.4 * k,
      blur: q * 6,
      o: 1 - seg(q, 0.7, 1),
    };
  };
  const sweep: Animator = (t, L) => {
    const k = seg(t, A + 0.5, A + 1.6, ease.inOutCubic);
    return { x: lerp(-L.W * 0.7, L.W * 0.7, k), o: Math.sin(Math.PI * k) * 0.8 };
  };
  const push: Animator = (t) => ({ s: 1.03 + 0.07 * seg(t, A, B, ease.linear) });
  return (
    <Shot range={[A, B + 0.05]} className="fl-persp">
      <Fx anchor={false} className="fl-full" fx={footage}>
        <Fx anchor={false} className="fl-full" fx={push}>
          <Clip name="laptop" range={[A, B + 0.05]} className="fl-grade fl-grade--soft" focus="30% 40%" />
        </Fx>
        <div className="fl-veil fl-veil--right" />
        <Fx anchor={false} className="fl-full fl-ib-sweep" fx={sweep} />
      </Fx>
      {SUGGESTIONS.map((s) => (
        <Floater key={s.label} s={s} />
      ))}
      <Composer />
      {BADGES.map((b) => (
        <PopBadge key={b.icon} b={b} />
      ))}
      <Cursor path={cursorPath} clicks={[CLICKS.chip, CLICKS.find]} range={[33.5, 36.7]} />
    </Shot>
  );
}
