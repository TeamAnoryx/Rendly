/**
 * Sound cues for the opening (film seconds 0-33); see shots-f.tsx and
 * shots-f2.tsx for the matching picture.
 */

import type { Cue } from './cues';
import { OPEN_SHIFT, rand } from './timeline';

const ticks = (t0: number, n: number, step: number, gain = 0.4): Cue[] =>
  Array.from({ length: n }, (_, i): Cue => ({ t: t0 + i * step, name: 'type', gain: gain * (0.6 + 0.4 * rand(i + t0)), pan: 0.15 }));

/** One soft tick per card as the rows peel away (two rows at a time). */
const CARD_EXITS: Cue[] = [0, 1, 2].flatMap((g) =>
  Array.from({ length: 6 }, (_, i): Cue => ({ t: 1.6 + g * 0.95 + i * 0.12, name: 'tick', gain: 0.2, pan: i % 2 ? 0.35 : -0.35 }))
);

export const OPEN_CUES: Cue[] = [
  // A: cards
  { t: 0.05, name: 'whoosh', gain: 0.35 },
  ...[0, 0.05, 0.1, 0.15, 0.2].map((t): Cue => ({ t: t + 0.4, name: 'tick', gain: 0.18 })),
  ...CARD_EXITS,
  ...[1.6, 2.55, 3.5].map((t): Cue => ({ t, name: 'whip', gain: 0.22 })),
  // B: chips, pill, badge
  { t: 4.62, name: 'pop', gain: 0.4 },
  { t: 4.88, name: 'shimmer', gain: 0.3 },
  { t: 5.05, name: 'click', gain: 0.55, pan: 0.2 },
  { t: 5.28, name: 'pop', gain: 0.5, pan: -0.3 },
  { t: 5.7, name: 'whip', gain: 0.45, pan: -0.5 },
  // C: Feeds pill, the star spins into the frame
  { t: 6.72, name: 'pop', gain: 0.45 },
  { t: 7.25, name: 'riser', gain: 0.35 },
  { t: 8.1, name: 'impact', gain: 0.45 },
  // D: toggle, glowing outline, burst
  { t: 8.6, name: 'shimmer', gain: 0.4 },
  { t: 9.5, name: 'ping', gain: 0.4 },
  { t: 9.6, name: 'whoosh', gain: 0.5 },
  // E: headline and phone
  { t: 10.42, name: 'shimmer', gain: 0.35 },
  { t: 11.32, name: 'whoosh', gain: 0.4 },
  ...ticks(12.0, 8, 0.056, 0.45),
  ...[12.2, 12.34, 12.48].map((t): Cue => ({ t, name: 'pop', gain: 0.3, pan: 0.2 })),
  { t: 12.8, name: 'whip', gain: 0.5 },
  { t: 13.2, name: 'whip', gain: 0.35 },
  { t: 14.3, name: 'thump', gain: 0.4 },
  { t: 14.7, name: 'whoosh', gain: 0.45 },
  { t: 15.7, name: 'chime', gain: 0.4 },
  // Landscape app: search, map, notifications, button
  ...ticks(15.85, 14, 0.07),
  ...ticks(17.15, 12, 0.07),
  ...ticks(18.4, 12, 0.07),
  ...[16.2, 17.5, 18.75].map((t): Cue => ({ t, name: 'pop', gain: 0.3 })),
  { t: 19.6, name: 'whoosh', gain: 0.3 },
  ...[19.95, 20.13, 20.31, 20.49].map((t, i): Cue => ({ t, name: 'ping', gain: 0.28, pan: -0.4 + i * 0.27 })),
  { t: 20.9, name: 'pop', gain: 0.4 },
  ...[23.8, 24.35, 24.9].map((t): Cue => ({ t, name: 'ping', gain: 0.4, pan: 0.4 })),
  { t: 25.5, name: 'pop', gain: 0.4 },
  { t: 26.45, name: 'click', gain: 0.7 },
  { t: 27.02, name: 'chime', gain: 0.45 },
  { t: 27.7, name: 'riser', gain: 0.35 },
  { t: 28.6, name: 'impact', gain: 0.45 },
  // F: city montage (old clock + OPEN_SHIFT)
  ...[5.7, 6.95, 7.9].map((t): Cue => ({ t: t + OPEN_SHIFT, name: 'thump', gain: 0.25 })),
];
