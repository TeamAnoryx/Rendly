'use client';

/**
 * Chapters 3-4 (11-29 s), in google2's language. A caption breaks into
 * fragments that drift apart in depth while the new line's fragments spring
 * onto the baseline, overshoot and settle; a hold, a slow grow, then a push
 * through the word. "Introducing" hands over to the white Rendly mark, which
 * zooms in like Gemini's sparkle, slides aside and is joined by the
 * wordtype as a full lockup; the lockup rises to a header while a prompt pill
 * types (and retypes) different reasons people connect, then folds into a
 * tilted prompt bar.
 */

import React from 'react';
import { RendlyMark, RendlyWordmark } from '@/components/brand/Brand';
import { Fx, Shot, type Animator } from './engine';
import { Aurora, Caption, ScatterLine } from './kit2';
import { pick, pop } from './kit';
import { Icon, SparkMark } from './primitives';
import { PILL_LINES, clamp, ease, lerp, retyped, seg, typedEnd } from './timeline';

/* ---------------- 3. Your why: break and recombine ---------------- */

const OUT_AT = 13.45;
const IN_AT = 13.7;
const GROW = 15.75;
const PUSH = 16.25;

export function ShotWhyScatter() {
  const lineA: Animator = (t, L) => {
    const k = seg(t, 11.3, 11.8, ease.std);
    const move = seg(t, 12.4, 13.1, ease.std);
    return { y: pick(L, 290, 420) * (1 - move), s: 0.75 + 0.25 * k, o: Math.min(1, k * 1.6), blur: (1 - k) * 6 };
  };
  const lineB: Animator = (t) => {
    const g = seg(t, GROW, PUSH, ease.inOutCubic);
    const p = seg(t, PUSH, PUSH + 0.5, ease.inExpo);
    return { s: (1 + 0.2 * g) * (1 + 13 * p), o: 1 - seg(t, PUSH + 0.3, PUSH + 0.5), blur: p * 8 };
  };
  return (
    <Shot range={[11.2, 16.8]}>
      <Aurora a={12.6} b={16.8} />
      <Fx className="fl-scatterline fl-scatterline--a" fx={lineA}>
        <ScatterLine text="Nobody's really *meeting*." tOut={OUT_AT} seed={3} spread={620} />
      </Fx>
      <Fx className="fl-scatterline fl-scatterline--b" fx={lineB}>
        <ScatterLine text="Know your *why*." tIn={IN_AT} seed={9} spread={640} />
      </Fx>
    </Shot>
  );
}

/* ---------------- 4. Rendly: mark, lockup, prompt ---------------- */

const ZOOM_A = 21.85;
const ZOOM_PEAK = 22.45;
const SETTLE = 22.95;
const WORD_IN = 22.85;
const HEADER = 24.0;
const FOLD = 27.25;

/** Lockup geometry on the canvas: mark and wordtype centres when assembled. */
const MARK_X = -266;
const WORD_X = 85;

function Lockup() {
  const group: Animator = (t, L) => {
    const up = seg(t, HEADER, HEADER + 0.45, ease.std);
    const gone = seg(t, FOLD - 0.3, FOLD, ease.exit);
    return { y: lerp(0, pick(L, -330, -470), up), s: (1 - 0.55 * up) * pick(L, 1, 0.8), o: 1 - gone };
  };
  const mark: Animator = (t) => {
    const zoom = seg(t, ZOOM_A, ZOOM_PEAK, ease.std);
    const back = seg(t, ZOOM_PEAK, SETTLE, ease.spring);
    const slide = seg(t, ZOOM_PEAK + 0.1, SETTLE + 0.15, ease.std);
    return {
      x: lerp(0, MARK_X, slide),
      s: lerp(lerp(0.12, 2.6, zoom), 1, back),
      rz: lerp(-60, 0, zoom),
      o: seg(t, ZOOM_A, ZOOM_A + 0.12),
      vars: { '--halo': (zoom * (1 - 0.7 * back)).toFixed(3) },
    };
  };
  const ring: Animator = (t) => {
    const k = seg(t, ZOOM_PEAK - 0.1, ZOOM_PEAK + 0.6, ease.outCubic);
    return { s: 0.6 + 2.4 * k, o: (t > ZOOM_PEAK - 0.1 ? 1 : 0) * (1 - k) * 0.8 };
  };
  const word: Animator = (t) => {
    const k = seg(t, WORD_IN, WORD_IN + 0.5, ease.std);
    return {
      x: WORD_X - (1 - k) * 60,
      o: clamp(k * 1.5),
      blur: (1 - k) * 10,
      clip: `inset(-20% ${((1 - k) * 100).toFixed(1)}% -20% 0)`,
    };
  };
  return (
    <Fx className="fl-lock" fx={group}>
      <Fx className="fl-lock-ring" fx={ring} />
      <Fx className="fl-lock-mark" fx={mark}>
        <RendlyMark className="fl-lock-markimg" />
      </Fx>
      <Fx className="fl-lock-word" fx={word}>
        <RendlyWordmark className="fl-lock-wordimg" tone="white" />
      </Fx>
    </Fx>
  );
}

function TypePill() {
  const pill: Animator = (t, L) => {
    const k = seg(t, HEADER + 0.25, HEADER + 0.6, ease.spring);
    const q = seg(t, FOLD, FOLD + 0.4, ease.exit);
    return { y: pick(L, 40, 0) - q * 40, s: (0.7 + 0.3 * k) * (1 - 0.3 * q), o: clamp(k * 1.5) * (1 - q) };
  };
  const text: Animator = (t) => ({ text: retyped(t, PILL_LINES) });
  const last = PILL_LINES[PILL_LINES.length - 1];
  const caret: Animator = (t) => ({ o: t > typedEnd(last) + 0.5 ? 0 : Math.floor(t * 2.4) % 2 === 0 || t < typedEnd(last) ? 1 : 0 });
  return (
    <Fx className="fl-typepill" fx={pill}>
      <SparkMark size={22} />
      <Fx as="span" anchor={false} fx={text} />
      <Fx as="span" anchor={false} className="fl-caret" fx={caret} />
    </Fx>
  );
}

export function ShotIntroducing() {
  const bar: Animator = (t, L) => {
    const k = seg(t, FOLD + 0.1, FOLD + 0.75, ease.std);
    const zoom = seg(t, 28.55, 29.2, ease.inCubic);
    return {
      y: pick(L, -20, -60),
      ry: -20 + 8 * seg(t, FOLD, 29.2, ease.linear),
      rx: 8,
      s: (0.86 + 0.14 * k) * (1 + 0.45 * zoom) * pick(L, 1, 0.9),
      o: k * (1 - zoom),
      blur: (1 - k) * 8 + zoom * 6,
    };
  };
  const card: Animator = (t, L) => {
    const p = pop(t, FOLD + 0.55, 0.55);
    const q = seg(t, 28.45, 28.9, ease.exit);
    return { x: pick(L, 300, 150), y: pick(L, 120, 120), s: p.s, o: p.o * (1 - q) };
  };
  return (
    <Shot range={[20.6, 29.25]} className="fl-persp">
      <Aurora a={20.7} b={29.2} />
      <Caption text="Introducing" t0={20.9} t1={22.0} from={0.6} className="fl-caption2--lg" />
      <Lockup />
      <TypePill />
      <Fx className="fl-tiltbar" fx={bar}>
        <span className="fl-tiltbar-text">Meet designers in Berlin</span>
        <span className="fl-tiltbar-row">
          <span className="fl-tiltbar-plus">
            <Icon name="plus" size={18} />
          </span>
          <span className="fl-chip fl-chip--sm">
            <Icon name="users" size={14} />
            Collaborate
          </span>
          <span className="fl-chip fl-chip--sm">
            <Icon name="pin" size={14} />
            Berlin
          </span>
          <span className="fl-tiltbar-send">
            <Icon name="arrow" size={18} />
          </span>
        </span>
      </Fx>
      <Fx className="fl-filecard" fx={card}>
        <span className="fl-filecard-icon">
          <Icon name="book" size={18} />
        </span>
        <span className="fl-filecard-body">
          <span className="fl-filecard-title">Spanish swap</span>
          <span className="fl-filecard-sub">Intent · Learn</span>
        </span>
      </Fx>
    </Shot>
  );
}
