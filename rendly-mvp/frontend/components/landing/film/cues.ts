/**
 * The film's sound cue sheet, in film seconds. Chapters authored on a local
 * clock bring their cues along through SHIFT. Effects are soft and sparse.
 */

import { CAPTIONS, CLICKS, COMPOSER_LINES, PILL_LINES, SPARK_CUT, SPARK_CUT_AT, filmTime, REPLY, SHIFT, rand, type TypedLine } from './timeline';
import { OPEN_CUES } from './open-cues';

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

/** One soft key tick per typed character (spaces skipped), in sync with the text. */
function keys(l: TypedLine, pan = 0.2, gain = 0.8): Cue[] {
  return Array.from(l.text).flatMap((ch, i): Cue[] =>
    ch === ' ' ? [] : [{ t: l.t0 + i * l.step, name: 'type', gain: gain * (0.55 + rand(i) * 0.45), pan }]
  );
}

const at = (shift: number, cues: Cue[]): Cue[] => cues.map((c) => ({ ...c, t: c.t + shift }));

/** Story-clock cues to film time; cues inside the cut part of the Spark call are dropped. */
const toFilm = (cues: Cue[]): Cue[] =>
  cues.filter((c) => c.t < SPARK_CUT_AT || c.t >= SPARK_CUT_AT + SPARK_CUT).map((c) => ({ ...c, t: filmTime(c.t) }));

/** The opening's cues live with the opening (film time). */
const OPEN: Cue[] = OPEN_CUES;

const FEEDS: Cue[] = at(SHIFT.feeds, [
  { t: 1.85, name: 'whoosh', gain: 0.35 },
  { t: 3.45, name: 'whip', gain: 0.3, pan: 0.2 },
]);

const WHY: Cue[] = [
  { t: 13.45, name: 'whoosh', gain: 0.35, pan: -0.2 },
  ...[13.95, 14.15, 14.35, 14.55].map((t, i): Cue => ({ t, name: 'pop', gain: 0.22, pan: (i % 2 ? 1 : -1) * 0.3 })),
  { t: 14.6, name: 'shimmer', gain: 0.4 },
  { t: 16.25, name: 'whoosh', gain: 0.45 },
  ...at(SHIFT.why, [{ t: 8.55, name: 'whoosh', gain: 0.35 }]),
];

const RENDLY: Cue[] = [
  { t: 20.9, name: 'pop', gain: 0.35 },
  { t: 21.85, name: 'riser', gain: 0.3 },
  { t: 22.45, name: 'impact', gain: 0.5 },
  { t: 22.9, name: 'whoosh', gain: 0.3, pan: 0.3 },
  { t: 24.0, name: 'whoosh', gain: 0.3 },
  { t: 24.3, name: 'pop', gain: 0.35 },
  ...PILL_LINES.flatMap((l) => keys(l, 0.1)),
  { t: 27.25, name: 'whoosh', gain: 0.35 },
  { t: 27.8, name: 'pop', gain: 0.45, pan: 0.3 },
  { t: 28.55, name: 'whoosh', gain: 0.35 },
];

const INTENT: Cue[] = [
  { t: 30.0, name: 'shimmer', gain: 0.3 },
  ...[30.4, 30.6, 30.8, 31.0].map((t, i): Cue => ({ t, name: 'blip', gain: 0.22, pan: -0.5 + i * 0.1 })),
  ...COMPOSER_LINES.flatMap((l) => keys(l, 0.3, 0.7)),
  { t: 31.1, name: 'pop', gain: 0.3, pan: 0.5 },
  { t: 33.05, name: 'pop', gain: 0.3, pan: -0.2 },
  { t: 33.15, name: 'pop', gain: 0.3, pan: 0.2 },
  ...[33.3, 33.42, 33.51, 33.6, 33.69, 33.78, 33.87].map((t, i): Cue => ({ t, name: 'pop', gain: 0.25, pan: 0.1 + i * 0.05 })),
  { t: CLICKS.chip, name: 'click', gain: 0.7, pan: 0.2 },
  { t: 34.55, name: 'pop', gain: 0.3, pan: 0.5 },
  { t: CLICKS.find, name: 'click', gain: 0.7, pan: 0.35 },
  { t: 36.35, name: 'chime', gain: 0.5, pan: 0.35 },
  { t: 36.95, name: 'whoosh', gain: 0.4 },
];

const DIFFERENT: Cue[] = [
  { t: 37.7, name: 'shimmer', gain: 0.3 },
  ...[38.2, 40.35, 42.4].flatMap((a): Cue[] => [
    { t: a, name: 'blip', gain: 0.3, pan: -0.4 },
    { t: a + 0.12, name: 'blip', gain: 0.3, pan: -0.3 },
    { t: a + 0.24, name: 'blip', gain: 0.3, pan: -0.2 },
    { t: a + 0.6, name: 'whoosh', gain: 0.25 },
    { t: a + 0.8, name: 'pop', gain: 0.4, pan: 0.4 },
  ]),
  { t: 44.2, name: 'whoosh', gain: 0.4 },
  { t: 44.85, name: 'riser', gain: 0.35 },
  { t: 45.1, name: 'impact', gain: 0.5 },
];

const MATCH: Cue[] = at(SHIFT.match, [
  { t: 17.5, name: 'blip', gain: 0.3, pan: -0.4 },
  { t: 17.8, name: 'blip', gain: 0.3, pan: -0.2 },
  { t: 18.1, name: 'blip', gain: 0.3, pan: -0.5 },
  { t: 19.0, name: 'tick', gain: 0.5, pan: 0.3 },
  { t: 19.6, name: 'tick', gain: 0.5, pan: 0.3 },
  { t: 20.2, name: 'tick', gain: 0.5, pan: 0.3 },
  { t: 21.35, name: 'chime', gain: 0.75 },
  { t: 22.6, name: 'whoosh', gain: 0.4 },
]);

const MEET_SPARK: Cue[] = at(SHIFT.meet, [
  { t: 23.3, name: 'whip', gain: 0.3, pan: -0.4 },
  { t: 23.35, name: 'whip', gain: 0.3, pan: 0.4 },
  { t: 24.4, name: 'pop', gain: 0.5 },
  { t: 24.7, name: 'pop', gain: 0.35, pan: -0.2 },
  { t: 24.85, name: 'pop', gain: 0.35, pan: 0.2 },
  { t: CLICKS.hello, name: 'click', gain: 0.75 },
  { t: 26.5, name: 'whoosh', gain: 0.4 },
  { t: 27.2, name: 'connect', gain: 0.75 },
  ...CAPTIONS.map((c): Cue => ({ t: c.t0 - 0.2, name: 'tick', gain: 0.25 })),
  { t: 34.6, name: 'whoosh', gain: 0.35 },
]);

const WHISPERS: Cue[] = [
  { t: 63.9, name: 'shimmer', gain: 0.3 },
  { t: 66.5, name: 'ping', gain: 0.5, pan: -0.2 },
  ...keys(REPLY, 0.25, 0.7),
  { t: 68.75, name: 'send', gain: 0.5, pan: 0.3 },
  { t: 69.4, name: 'ping', gain: 0.5, pan: -0.2 },
  { t: 70.3, name: 'whoosh', gain: 0.3 },
  { t: 71.2, name: 'pop', gain: 0.3, pan: 0.4 },
  { t: 71.7, name: 'click', gain: 0.7, pan: 0.4 },
  { t: 72.0, name: 'whip', gain: 0.3, pan: 0.2 },
  { t: 72.8, name: 'pop', gain: 0.4 },
  { t: 73.8, name: 'click', gain: 0.7, pan: 0.4 },
  { t: 74.0, name: 'pop', gain: 0.4, pan: 0.3 },
  { t: 75.6, name: 'whoosh', gain: 0.4 },
];

const HUDDLES: Cue[] = [
  { t: 76.15, name: 'whoosh', gain: 0.3 },
  ...[76.5, 76.6, 76.7, 76.8].map((t): Cue => ({ t, name: 'tick', gain: 0.25 })),
  { t: 77.0, name: 'ping', gain: 0.45, pan: 0.3 },
  { t: 78.7, name: 'click', gain: 0.7, pan: 0.4 },
  { t: 78.85, name: 'whoosh', gain: 0.45 },
  ...[79.5, 79.75, 80.0, 80.25, 80.6, 80.85].map((t, i): Cue => ({ t, name: 'pop', gain: 0.35, pan: -0.5 + i * 0.2 })),
  { t: 81.3, name: 'shimmer', gain: 0.3 },
  ...[83.3, 83.55, 83.8, 85.2, 85.45, 85.7, 86.2].map((t): Cue => ({ t, name: 'blip', gain: 0.22, pan: 0.5 })),
  { t: 83.6, name: 'pop', gain: 0.4, pan: 0.3 },
  { t: 84.9, name: 'whip', gain: 0.25 },
  { t: 87.0, name: 'click', gain: 0.7, pan: 0.2 },
  { t: 87.15, name: 'ping', gain: 0.45 },
  { t: 88.9, name: 'whoosh', gain: 0.45 },
  { t: 89.4, name: 'pop', gain: 0.5 },
  ...[90.0, 90.2, 90.4, 90.6].map((t): Cue => ({ t, name: 'tick', gain: 0.25 })),
  { t: 92.3, name: 'whoosh', gain: 0.4 },
];

const REAL: Cue[] = [
  ...at(SHIFT.offline, [{ t: 76.6, name: 'shimmer', gain: 0.3 }]),
  ...at(SHIFT.real, [
    { t: 50.3, name: 'pop', gain: 0.4 },
    { t: 52.6, name: 'whoosh', gain: 0.35 },
  ]),
  { t: 102.8, name: 'whoosh', gain: 0.35 },
];

const END: Cue[] = [
  ...at(SHIFT.end, [
    { t: 53.3, name: 'shimmer', gain: 0.45 },
    { t: 55.6, name: 'thump', gain: 0.45 },
    { t: 56.9, name: 'pop', gain: 0.35 },
  ]),
  ...Array.from({ length: 7 }, (_, i): Cue => ({ t: 109.4 + i * 1.3, name: 'tick', gain: 0.18 })),
];

export const CUES: readonly Cue[] = [
  ...OPEN,
  ...toFilm([
  ...FEEDS,
  ...WHY,
  ...RENDLY,
  ...INTENT,
  ...DIFFERENT,
  ...MATCH,
  ...MEET_SPARK,
  ...WHISPERS,
  ...HUDDLES,
  ...REAL,
  ...END,
  ]),
].sort((a, b) => a.t - b.t);

/** Cues whose time lies in (from, to], handling the loop seam. */
export function cuesBetween(from: number, to: number): Cue[] {
  if (to >= from) return CUES.filter((c) => c.t > from && c.t <= to);
  return CUES.filter((c) => c.t > from || c.t <= to);
}
