/**
 * The launch film's clock maths: easing curves, keyframe interpolation, the
 * shot list and the sound cue sheet. Everything on screen is a pure function
 * of the film time `t` (seconds), so the film can be scrubbed, looped and
 * captured frame by frame.
 */

export const DURATION = 40;
/** 120 BPM: one beat every half second, one bar every two. */
export const BEAT = 0.5;

export type Ease = (x: number) => number;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** CSS-style cubic-bezier easing, solved by Newton iteration. */
function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= (sx(u) - x) / d;
    }
    return sy(Math.min(1, Math.max(0, u)));
  };
}

export const ease = {
  linear: (x: number) => x,
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  inCubic: (x: number) => x * x * x,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuint: (x: number) => 1 - Math.pow(1 - x, 5),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  outBack: (x: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  /** Material 3 "emphasized" standard curve, cubic-bezier(0.2, 0, 0, 1). */
  std: bezier(0.2, 0, 0, 1),
  /** Material 3 emphasized accelerate, for exits. */
  exit: bezier(0.3, 0, 0.8, 0.15),
  /** A soft spring: overshoots once and settles. */
  spring: (x: number) => (x >= 1 ? 1 : 1 - Math.exp(-6.5 * x) * Math.cos(9 * x)),
} satisfies Record<string, Ease>;

/** 0..1 progress of `t` through [a, b], eased. */
export function seg(t: number, a: number, b: number, e: Ease = ease.linear): number {
  if (b <= a) return t >= b ? 1 : 0;
  return e(clamp((t - a) / (b - a)));
}

/** Piecewise keyframes: [[time, value], ...] with one ease between each pair. */
export function kf(t: number, keys: ReadonlyArray<readonly [number, number]>, e: Ease = ease.inOutCubic): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, e(clamp((t - t0) / (t1 - t0 || 1))));
    }
  }
  return keys[keys.length - 1][1];
}

/** 1 inside [a, b], ramping over `fi` seconds in and `fo` seconds out. */
export function env(t: number, a: number, b: number, fi = 0.4, fo = 0.4): number {
  return Math.min(seg(t, a, a + fi, ease.outCubic), 1 - seg(t, b - fo, b, ease.inCubic));
}

/** Deterministic pseudo-random in [0, 1) for an integer seed. */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface Shot {
  id: string;
  label: string;
  start: number;
  end: number;
}

export const SHOTS: readonly Shot[] = [
  { id: 'why', label: 'Your why', start: 0, end: 5 },
  { id: 'intent', label: 'Intent', start: 5, end: 11 },
  { id: 'match', label: 'Matching', start: 11, end: 17 },
  { id: 'meet', label: 'Match', start: 17, end: 22 },
  { id: 'call', label: 'Video', start: 22, end: 29 },
  { id: 'whispers', label: 'Whispers', start: 29, end: 34 },
  { id: 'end', label: 'Rendly', start: 34, end: 40 },
];

export function shotAt(t: number): number {
  const i = SHOTS.findIndex((s) => t >= s.start && t < s.end);
  return i < 0 ? SHOTS.length - 1 : i;
}

export type CueName =
  | 'whoosh'
  | 'whip'
  | 'tick'
  | 'pop'
  | 'click'
  | 'type'
  | 'blip'
  | 'chime'
  | 'riser'
  | 'impact'
  | 'shimmer'
  | 'connect'
  | 'ping'
  | 'send'
  | 'thump';

export interface Cue {
  t: number;
  name: CueName;
  /** 0..1 gain multiplier. */
  gain?: number;
  /** Stereo pan, -1 (left) to 1 (right). */
  pan?: number;
}

const typing = (from: number, to: number, step: number, pan = 0.25): Cue[] => {
  const out: Cue[] = [];
  for (let t = from, i = 0; t < to; t += step, i++) out.push({ t, name: 'type', gain: 0.5 + rand(i) * 0.5, pan });
  return out;
};

/** The sound design, in film seconds. Soft and sparse, mixed under the music. */
export const CUES: readonly Cue[] = [
  { t: 0.3, name: 'shimmer', gain: 0.35 },
  { t: 4.7, name: 'whoosh', gain: 0.35 },
  { t: 5.9, name: 'tick', gain: 0.45, pan: -0.2 },
  { t: 6.6, name: 'click', gain: 0.6, pan: -0.1 },
  ...typing(7.2, 9.4, 0.085),
  { t: 9.8, name: 'send', gain: 0.6, pan: 0.3 },
  { t: 11.2, name: 'shimmer', gain: 0.4 },
  { t: 12.4, name: 'blip', gain: 0.35, pan: -0.3 },
  { t: 13.2, name: 'blip', gain: 0.35, pan: 0.3 },
  { t: 14.0, name: 'blip', gain: 0.35, pan: 0 },
  { t: 14.9, name: 'chime', gain: 0.7 },
  { t: 16.8, name: 'whoosh', gain: 0.4 },
  { t: 17.6, name: 'pop', gain: 0.4, pan: -0.4 },
  { t: 17.8, name: 'pop', gain: 0.4, pan: 0.4 },
  { t: 20.6, name: 'click', gain: 0.6 },
  { t: 22.3, name: 'connect', gain: 0.7 },
  { t: 28.8, name: 'whoosh', gain: 0.4 },
  { t: 29.9, name: 'ping', gain: 0.5, pan: -0.2 },
  { t: 31.3, name: 'send', gain: 0.5, pan: 0.3 },
  { t: 32.7, name: 'ping', gain: 0.5, pan: -0.2 },
  { t: 33.8, name: 'whoosh', gain: 0.4 },
  { t: 35.2, name: 'shimmer', gain: 0.5 },
  { t: 36.4, name: 'thump', gain: 0.5 },
];

/** Cues whose time lies in (from, to], handling the loop seam. */
export function cuesBetween(from: number, to: number): Cue[] {
  if (to >= from) return CUES.filter((c) => c.t > from && c.t <= to);
  return CUES.filter((c) => c.t > from || c.t <= to);
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
