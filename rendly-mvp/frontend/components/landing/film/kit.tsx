'use client';

/**
 * Launch-film building blocks in the Google product-film idiom: a gliding
 * cursor with click ripples, text that types itself, chips that pop, and
 * masked footage panels. All of it is a pure function of the film clock.
 */

import React from 'react';
import { Fx, type Animator, type Layout, type Pose } from './engine';
import { clamp, ease, kf, seg, typed, type TypedLine } from './timeline';

/** Picks the landscape or portrait value. */
export const pick = <T,>(L: Layout, land: T, port: T): T => (L.portrait ? port : land);

/** Material "pop": scale from 0.6 with a soft overshoot, plus fade. */
export function pop(t: number, t0: number, dur = 0.45): { s: number; o: number } {
  const k = seg(t, t0, t0 + dur, ease.spring);
  return { s: 0.6 + 0.4 * k, o: seg(t, t0, t0 + dur * 0.4) };
}

/** Slide up and settle in, fade out. Returns a Pose. */
export function rise(t: number, a: number, b: number, dist = 40, fi = 0.8, fo = 0.5): Pose {
  const k = seg(t, a, a + fi, ease.std);
  const q = seg(t, b - fo, b, ease.exit);
  return { y: (1 - k) * dist - q * dist * 0.4, o: k * (1 - q), blur: (1 - k) * 8 + q * 6 };
}

/** Rounded-rect wipe: inset() clip that opens from a centred box to the full frame. */
export function insetWipe(k: number, fromW: number, fromH: number, W: number, H: number, r0 = 28, r1 = 0): string {
  const w = fromW + (W - fromW) * k;
  const h = fromH + (H - fromH) * k;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  const r = r0 + (r1 - r0) * k;
  return `inset(${y.toFixed(1)}px ${x.toFixed(1)}px round ${r.toFixed(1)}px)`;
}

/** Circle wipe from a point (canvas px, origin top-left). */
export function circleWipe(k: number, cx: number, cy: number, maxR: number): string {
  return `circle(${(Math.max(0, k) * maxR).toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px)`;
}

/* ---------------- Typing ---------------- */

export interface TypedTextProps {
  line: TypedLine;
  className?: string;
  /** Hide the caret after this time. */
  caretUntil?: number;
}

/** Text that types in character by character, with a blinking caret. */
export function TypedText({ line, className = '', caretUntil }: TypedTextProps) {
  const text: Animator = (t) => ({ text: typed(t, line) });
  const end = line.t0 + line.text.length * line.step;
  const caret: Animator = (t) => {
    const until = caretUntil ?? end + 1.2;
    const typing = t >= line.t0 - 0.6 && t <= end;
    const blink = typing ? 1 : Math.floor(t * 2.2) % 2 === 0 ? 1 : 0;
    return { o: t < line.t0 - 0.6 || t > until ? 0 : blink };
  };
  return (
    <span className={`fl-typed ${className}`}>
      <Fx as="span" anchor={false} fx={text} />
      <Fx as="span" anchor={false} className="fl-caret" fx={caret} />
    </span>
  );
}

/* ---------------- Cursor ---------------- */

export type CursorKey = readonly [number, number, number];

export interface CursorProps {
  /** [time, x, y] keyframes (x, y from canvas centre). */
  path: (L: Layout) => ReadonlyArray<CursorKey>;
  clicks: readonly number[];
  /** Visible window. */
  range: readonly [number, number];
}

function cursorAt(t: number, keys: ReadonlyArray<CursorKey>): [number, number] {
  const xs = keys.map(([tt, x]) => [tt, x] as const);
  const ys = keys.map(([tt, , y]) => [tt, y] as const);
  return [kf(t, xs, ease.std), kf(t, ys, ease.std)];
}

/** A macOS-style pointer that glides between targets and presses on click. */
export function Cursor({ path, clicks, range }: CursorProps) {
  const pointer: Animator = (t, L) => {
    const [x, y] = cursorAt(t, path(L));
    const o = seg(t, range[0], range[0] + 0.3) * (1 - seg(t, range[1] - 0.3, range[1]));
    const press = clicks.reduce((m, c) => Math.max(m, 1 - Math.abs(t - c) / 0.12), 0);
    return { x: x + 11, y: y + 14, o, s: 1 - 0.14 * clamp(press) };
  };
  return (
    <>
      {clicks.map((c) => {
        const ripple: Animator = (t, L) => {
          const [x, y] = cursorAt(c, path(L));
          const k = seg(t, c, c + 0.7, ease.outCubic);
          const on = t >= c && t <= c + 0.7;
          return { x, y, s: 0.2 + 2.2 * k, o: on ? 0.55 * (1 - k) : 0 };
        };
        return <Fx key={c} className="fl-ripple" fx={ripple} />;
      })}
      <Fx className="fl-cursor" fx={pointer}>
        <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
          <path
            d="M3 2.5v22.2c0 .9 1.1 1.3 1.7.7l5.2-5.4 3.7 8.3c.3.6 1 .9 1.6.6l2.6-1.2c.6-.3.9-1 .6-1.6l-3.7-8.2 7.4-.4c.9 0 1.3-1.1.6-1.7L4.7 1.8C4 1.2 3 1.6 3 2.5Z"
            fill="#fff"
            stroke="#0a0a0b"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </Fx>
    </>
  );
}

/* ---------------- Chips and kinetic type ---------------- */

export interface ChipProps {
  t0: number;
  /** Exit time, if the chip leaves. */
  t1?: number;
  className?: string;
  children: React.ReactNode;
  anchor?: boolean;
  x?: (L: Layout) => number;
  y?: (L: Layout) => number;
}

/** A pill that pops in (spring) and optionally fades out. */
export function Chip({ t0, t1, className = '', children, anchor = false, x, y }: ChipProps) {
  const fx: Animator = (t, L) => {
    const p = pop(t, t0);
    const q = t1 === undefined ? 0 : seg(t, t1, t1 + 0.35, ease.exit);
    return { s: p.s, o: p.o * (1 - q), x: x?.(L), y: y?.(L) };
  };
  return (
    <Fx as="span" anchor={anchor} className={`fl-chip ${className}`} fx={fx}>
      {children}
    </Fx>
  );
}

export interface LineProps {
  text: string;
  t0: number;
  t1: number;
  className?: string;
  /** Centre on (x, y) (default) or leave placement to CSS. */
  anchor?: boolean;
  x?: (L: Layout) => number;
  y?: (L: Layout) => number;
}

/** One bold line of kinetic type: rises out of a soft blur, leaves upward. */
export function KLine({ text, t0, t1, className = '', anchor = true, x, y }: LineProps) {
  const fx: Animator = (t, L) => {
    const r = rise(t, t0, t1, 36, 0.9, 0.45);
    return { ...r, x: x?.(L), y: (y?.(L) ?? 0) + (r.y ?? 0) };
  };
  return (
    <Fx anchor={anchor} className={`fl-kline ${className}`} fx={fx}>
      {text}
    </Fx>
  );
}
