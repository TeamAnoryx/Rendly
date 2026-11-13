'use client';

/**
 * Motion vocabulary lifted from Google's launch films (see the shot notes):
 * small centred captions that scale-swap, lines that shatter into letter
 * fragments and reassemble as a new line, push-through-the-word transitions,
 * text that decodes from scrambled glyphs, aurora light on black and shimmer
 * skeleton loaders.
 */

import React from 'react';
import { Fx, type Animator, type Layout } from './engine';
import { clamp, ease, rand, seg } from './timeline';

/* ---------------- Rich text: *word* marks the accent ---------------- */

interface Token {
  text: string;
  accent: boolean;
}

function tokens(text: string): Token[] {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (p.startsWith('*') ? { text: p.slice(1, -1), accent: true } : { text: p, accent: false }));
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {tokens(text).map((tk, i) => (
        <span key={i} className={tk.accent ? 'fl-accent' : undefined}>
          {tk.text}
        </span>
      ))}
    </>
  );
}

/* ---------------- Caption: scale-swap in, scale-down out ---------------- */

export interface CaptionProps {
  text: string;
  t0: number;
  t1: number;
  /** Entry scale: < 1 grows in ("Introducing"), > 1 settles down (a swapped-in line). */
  from?: number;
  className?: string;
  y?: (L: Layout) => number;
  x?: (L: Layout) => number;
}

export function Caption({ text, t0, t1, from = 0.7, className = '', y, x }: CaptionProps) {
  const fx: Animator = (t, L) => {
    const k = seg(t, t0, t0 + 0.5, ease.std);
    const q = seg(t, t1 - 0.3, t1, ease.exit);
    return {
      x: x?.(L),
      y: y?.(L),
      s: (from + (1 - from) * k) * (1 - 0.4 * q),
      o: Math.min(1, k * 1.6) * (1 - q),
      blur: (1 - k) * 6 + q * 3,
    };
  };
  return (
    <Fx className={`fl-caption2 ${className}`} fx={fx}>
      <Rich text={text} />
    </Fx>
  );
}

/* ---------------- Scatter: a line shatters into fragments, another assembles ---------------- */

interface Frag {
  text: string;
  accent: boolean;
  space: boolean;
}

/** Splits a line into 2-3 letter fragments, keeping spaces and accents. */
function fragments(text: string): Frag[] {
  const out: Frag[] = [];
  for (const tk of tokens(text)) {
    for (const part of tk.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out.push({ text: ' ', accent: false, space: true });
        continue;
      }
      for (let i = 0; i < part.length; ) {
        const n = part.length - i <= 3 ? part.length - i : 2 + (Math.floor(rand(out.length * 3.7) * 2) % 2);
        out.push({ text: part.slice(i, i + n), accent: tk.accent, space: false });
        i += n;
      }
    }
  }
  return out;
}

export interface ScatterLineProps {
  text: string;
  /** Assemble window start (fragments fly in from scattered positions). */
  tIn?: number;
  /** Shatter window start (fragments fly out). */
  tOut?: number;
  seed?: number;
  /** Spread in canvas px. */
  spread?: number;
  /** Optional per-fragment text override (for decoding). */
  decode?: (t: number, frag: string, index: number) => string;
}

/** One line whose fragments are animated independently. Place inside an anchored Fx. */
export function ScatterLine({ text, tIn, tOut, seed = 1, spread = 420, decode }: ScatterLineProps) {
  const frags = fragments(text);
  return (
    <span className="fl-scatter">
      {frags.map((f, i) => {
        if (f.space) return <span key={i}> </span>;
        const a = rand(seed * 31 + i * 7.13) * Math.PI * 2;
        const r = 0.45 + rand(seed * 17 + i * 3.1) * 0.55;
        const z = 0.45 + rand(seed * 13 + i * 5.7) * 1.4;
        const dx = Math.cos(a) * r * spread;
        const dy = Math.sin(a) * r * spread * 0.55;
        const fx: Animator = (t) => {
          // In: fragments appear scattered in depth, drift a little, then spring onto the
          // baseline, overshoot and settle (google2 8.2 s).
          const a0 = (tIn ?? 0) + i * 0.03;
          const drift = tIn === undefined ? 1 : seg(t, a0, a0 + 0.45, ease.linear);
          const kin = tIn === undefined ? 1 : seg(t, a0 + 0.4, a0 + 1.7, ease.spring);
          // Out: fragments drift apart slowly in depth while fading (google2 7.4 s).
          const b0 = (tOut ?? 1e9) + i * 0.012;
          const kout = tOut === undefined ? 0 : seg(t, b0, b0 + 1.7, ease.outCubic);
          const d = (1 - kin) * (1 - 0.15 * drift) + kout;
          const oin = tIn === undefined ? 1 : clamp(seg(t, a0, a0 + 0.3) * 1.2);
          const oout = tOut === undefined ? 1 : 1 - seg(t, b0 + 0.6, b0 + 1.5);
          return {
            x: dx * d,
            y: dy * d,
            s: 1 + (z - 1) * d,
            o: oin * oout,
            blur: Math.abs(z - 1) * clamp(Math.abs(d)) * 3,
            text: decode ? decode(t, f.text, i) : undefined,
          };
        };
        return (
          <Fx key={i} as="span" anchor={false} className={`fl-frag${f.accent ? ' fl-accent' : ''}`} fx={fx}>
            {f.text}
          </Fx>
        );
      })}
    </span>
  );
}

const GLYPHS = '@#%&*+=?/<>[]{}01xyzwh';

/** Decodes text from scrambled glyphs, left to right, over [t0, t1]. */
export function scramble(t: number, text: string, t0: number, t1: number, offset = 0, total = text.length): string {
  if (t >= t1) return text;
  return Array.from(text)
    .map((ch, i) => {
      if (ch === ' ') return ch;
      const at = t0 + ((t1 - t0) * (i + offset)) / Math.max(1, total);
      if (t >= at) return ch;
      return GLYPHS[Math.floor(rand(Math.floor(t * 22) * 13 + (i + offset) * 7) * GLYPHS.length)];
    })
    .join('');
}

/* ---------------- Light ---------------- */

/** Blue/violet aurora rising from the bottom edge of a black frame. */
export function Aurora({ a, b, className = '' }: { a: number; b: number; className?: string }) {
  const fx: Animator = (t) => ({
    o: seg(t, a, a + 0.8) * (1 - seg(t, b - 0.6, b)) * (0.8 + 0.2 * Math.sin(t * 1.3)),
  });
  return <Fx anchor={false} className={`fl-aurora ${className}`} fx={fx} />;
}

/** Skeleton bars with a moving highlight (loading state). */
export function Shimmer({ lines = 3, t0, t1, className = '' }: { lines?: number; t0: number; t1: number; className?: string }) {
  const fx: Animator = (t) => ({
    o: seg(t, t0, t0 + 0.3) * (1 - seg(t, t1 - 0.3, t1)),
    vars: { '--shim': `${(((t - t0) * 70) % 200) - 50}%` },
  });
  return (
    <Fx anchor={false} className={`fl-shimmer ${className}`} fx={fx}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="fl-shimmer-bar" style={{ width: `${100 - i * 18}%` }} />
      ))}
    </Fx>
  );
}
