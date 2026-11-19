/**
 * The launch film's clock maths: easing curves, keyframe interpolation, the
 * shot list and the sound cue sheet. Everything on screen is a pure function
 * of the film time `t` (seconds), so the film can be scrubbed, looped and
 * captured frame by frame.
 */

/**
 * The opening was lengthened after the rest of the film was authored, so every
 * chapter after it runs OPEN_SHIFT seconds later than its own clock says.
 */
export const OPEN_SHIFT = 24;
/** Film time where the opening hands over to the rest of the film. */
export const OPEN_END = 9 + OPEN_SHIFT;
/** The Spark call's last 1.5 s (story 62.2-63.7) was cut; later chapters move up by SPARK_CUT. */
export const SPARK_CUT_AT = 62.2;
export const SPARK_CUT = 1.5;
/** End of the authored clock (the scenes' own seconds). */
export const AUTH_END = 120 + OPEN_SHIFT - SPARK_CUT - 0.2;
/** Length of the film as played: the voice-over track (RendlyVedioVoiceOver.mp3). */
export const DURATION = 149;

/**
 * The voice-over cut. Scenes are authored on their own clock; this map re-times
 * them against the narration: [authored seconds, played seconds], both rising.
 * Between anchors time runs linearly, so a scene plays slower or faster to land
 * on its line (clips follow the same rate, see clips.tsx).
 */
const WARP: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [10.4, 10.4], // "So we built something different."
  [11.3, 11.7], // phone rises
  [12.8, 15.0], // portrait screen held ~3.3 s for its UI
  [15.85, 17.6], // the phone, slower: "Your people are out there..."
  [19.55, 23.5], // search: "...jamming with musicians nearby."
  [23.55, 27.3], // map: "Instantly, you see who's close..."
  [27.7, 31.4], // notifications: "Three new matches..."
  [28.75, 32.45], // the phone leaves (1 s)
  [33.05, 37.25], // cities and feeds
  [37.0, 41.2], // "Endless scrolling..."
  [44.75, 48.9], // "Real connection starts with your why."
  [46.85, 50.4], // "This is Rendly."
  [54.0, 58.2], // "Tell Rendly your why..."
  [61.65, 67.25], // "Most apps are built for attention..."
  [68.85, 74.65], // "Rendly is built for meeting."
  [69.65, 77.0], // the logo holds ~1.2 s, then a 1 s exit (CenterMark is authored in played time)
  [75.6, 82.6], // "Matched on why... Meet Jordan."
  [79.9, 85.6], // "Start with a spark."
  [98.55, 104.3], // Whispers, then "Huddles..."
  [111.4, 117.0], // "Jump in, share ideas..."
  [115.6, 123.0], // the plan: "And when it clicks? Saturday, take it offline."
  [119.2, 126.0], // "Less scrolling, more meeting."
  [125.45, 132.15], // "Your people are out there."
  [AUTH_END, DURATION], // "Rendly. Know your why. Find your who."
];

function interp(v: number, from: 0 | 1, to: 0 | 1): number {
  const last = WARP[WARP.length - 1];
  if (v <= 0) return 0;
  if (v >= last[from]) return last[to];
  let i = 1;
  while (WARP[i][from] < v) i += 1;
  const a = WARP[i - 1];
  const b = WARP[i];
  return a[to] + ((v - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
}

/** Authored (scene) time for a played film time. */
export const authored = (n: number) => interp(n, 1, 0);
/** Played film time for an authored (scene) time. */
export const played = (a: number) => interp(a, 0, 1);

/** Authored seconds per played second at played time n (footage plays at this rate). */
export function rateAt(n: number): number {
  const lo = Math.max(0, n - 0.05);
  const hi = Math.min(DURATION, n + 0.05);
  return hi > lo ? (authored(hi) - authored(lo)) / (hi - lo) : 1;
}

/** Film time for a story-clock time after the opening. */
export function filmTime(story: number): number {
  if (story >= SPARK_CUT_AT + SPARK_CUT) return story + OPEN_SHIFT - SPARK_CUT;
  return Math.min(story, SPARK_CUT_AT) + OPEN_SHIFT;
}
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

/** Chapters after the opening, on their own (pre-OPEN_SHIFT) clock. */
const STORY: readonly Shot[] = [
  { id: 'feeds', label: 'Feeds', start: 9, end: 13 },
  { id: 'why', label: 'Your why', start: 13, end: 20.7 },
  { id: 'rendly', label: 'Rendly', start: 20.7, end: 29 },
  { id: 'intent', label: 'Intent', start: 29, end: 37.6 },
  { id: 'different', label: 'Why Rendly', start: 37.6, end: 45.6 },
  { id: 'match', label: 'Matching', start: 45.6, end: 51.6 },
  { id: 'meet', label: 'Meet', start: 51.6, end: 55.4 },
  { id: 'spark', label: 'Spark call', start: 55.4, end: 63.7 },
  { id: 'whispers', label: 'Whispers', start: 63.7, end: 76 },
  { id: 'huddles', label: 'Huddles', start: 76, end: 93 },
  { id: 'real', label: 'Real life', start: 93, end: 104.75 },
  { id: 'end', label: 'Get started', start: 104.75, end: 120 },
];

/** Fourteen chapters: one person's story from feed to face to face. */
export const SHOTS: readonly Shot[] = [
  { id: 'open', label: 'Opening', start: 0, end: 28.7 },
  { id: 'online', label: 'Online', start: 28.7, end: OPEN_END },
  ...STORY.map((s) => ({ ...s, start: filmTime(s.start), end: filmTime(s.end) })),
];

/** The chapters on the played clock (for the scrubber). */
export const CHAPTERS: readonly Shot[] = SHOTS.map((s, i) => ({
  ...s,
  start: played(s.start),
  end: i === SHOTS.length - 1 ? DURATION : played(s.end),
}));

/** The pre-OPEN_SHIFT clock for a film time (the opening is compressed into 0-9). */
export function storyTime(t: number): number {
  if (t < OPEN_END) return (t / OPEN_END) * 9;
  const st = t - OPEN_SHIFT;
  return st >= SPARK_CUT_AT ? st + SPARK_CUT : st;
}

/**
 * Several chapters are authored on their own local clock (the original
 * one-minute cut) and re-timed into the two-minute film. Film time =
 * local time + shift. Every shifted range is used exactly once.
 */
export const SHIFT = {
  feeds: 7.4,
  why: 11.55,
  match: 28.4,
  meet: 28.7,
  offline: 17.1,
  real: 49.6,
  end: 51.8,
} as const;

export function shotAt(t: number): number {
  const i = SHOTS.findIndex((s) => t >= s.start && t < s.end);
  return i < 0 ? SHOTS.length - 1 : i;
}

/* ---------------- Typed lines (shared by the shots and the cue sheet) ---------------- */

export interface TypedLine {
  text: string;
  /** First character appears at t0. */
  t0: number;
  /** Seconds per character. */
  step: number;
}

export const typedEnd = (l: TypedLine) => l.t0 + l.text.length * l.step;

/** Characters of `l` visible at time t. */
export function typed(t: number, l: TypedLine): string {
  const n = Math.max(0, Math.min(l.text.length, Math.floor((t - l.t0) / l.step) + 1));
  return t < l.t0 ? '' : l.text.slice(0, n);
}

/** Her why, typed in the composer (film time). */
export const PROMPT: TypedLine = { text: 'Meet people who care about the climate', t0: 31.6, step: 0.04 };
/** Whispers reply (film time). */
export const REPLY: TypedLine = { text: 'Coffee on Thursday?', t0: 67.4, step: 0.06 };
export const CAPTIONS: readonly (TypedLine & { who: string })[] = [
  { who: 'Jordan', text: 'So what pulled you into climate?', t0: 28.6, step: 0.036 },
  { who: 'You', text: 'I help run a solar co-op on weekends.', t0: 30.5, step: 0.034 },
  { who: 'Jordan', text: "No way. I've wanted to join one.", t0: 32.1, step: 0.03 },
];

/** Different reasons people connect, retyped in the growing pill (film time). */
export const PILL_LINES: readonly TypedLine[] = [
  { text: 'Find people to start a run club with', t0: 24.55, step: 0.03 },
  { text: 'Practice Spanish with a native speaker', t0: 25.95, step: 0.028 },
];
/** Intents cycled in the composer before she types her own (film time). */
export const COMPOSER_LINES: readonly TypedLine[] = [
  { text: 'Talk startups over coffee', t0: 30.35, step: 0.03 },
  PROMPT,
];

/**
 * Text of a field that types each line, holds, then deletes it before the
 * next one starts. The last line stays.
 */
export function retyped(t: number, lines: readonly TypedLine[], del = 0.28): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (t < l.t0) continue;
    const next = lines[i + 1];
    const full = typed(t, l);
    if (!next) return full;
    const d0 = next.t0 - del;
    if (t < d0) return full;
    const keep = Math.round(l.text.length * (1 - clamp((t - d0) / del)));
    return l.text.slice(0, keep);
  }
  return '';
}

/* ---------------- Clicks (local clocks; see SHIFT) ---------------- */

export const CLICKS = {
  /** Intent chapter, film time. */
  chip: 34.4,
  find: 35.65,
  /** Meet chapter, local clock (see SHIFT.meet). */
  hello: 26.15,
} as const;

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
