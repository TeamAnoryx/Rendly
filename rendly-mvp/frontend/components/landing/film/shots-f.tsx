'use client';

/**
 * Chapter 1 (0-33 s): the opening.
 *  A  0.0-4.6   Rows of people cards drift in alternating directions, then
 *               peel off one by one, top and bottom rows first.
 *  B  4.6-6.8   Intent chips inside a glass pill; the black Rendly badge
 *               lands at its left end and leads the pill out of frame.
 *  C  6.7-8.25  The "Feeds" pill; its star spins clockwise and grows until
 *               it fills the frame.
 *  D  8.0-10.5  The dark Feeds | Rendly toggle. A light point draws a glowing
 *               outline round it, then the outline bursts outwards.
 *  E  10.4-12   "Your people are out there." folds into the phone (shots-f2).
 *  F  28.7-33   City montage (authored on the old clock, shifted by OPEN_SHIFT).
 */

import React from 'react';
import { RendlyMark } from '@/components/brand/Brand';
import { Clip, type ClipName } from './clips';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Caption } from './kit2';
import { pick } from './kit';
import { Icon, SparkMark, type IconName } from './primitives';
import { PhoneSpin } from './shots-f2';
import { OPEN_SHIFT, ease, lerp, rand, seg } from './timeline';

const sc = (L: Layout) => pick(L, 1, 0.78);

/* ---------------- A: rows of people cards ---------------- */

const PEOPLE: ReadonlyArray<readonly [string, string, IconName]> = [
  ['Ana', 'Run club, Sundays', 'run'],
  ['Leo', 'Spanish swap', 'globe'],
  ['Kai', 'Weekend jam', 'music'],
  ['Mia', 'Book club', 'book'],
  ['Sam', 'Hack night', 'code'],
  ['Noor', 'Climate talks', 'leaf'],
  ['Eli', 'Coffee chats', 'chat'],
  ['Zoe', 'Mentoring', 'users'],
  ['Raj', 'Startup ideas', 'rocket'],
  ['Ivy', 'Photo walks', 'pin'],
  ['Tom', 'Study buddy', 'book'],
  ['Lin', 'Climbing crew', 'heart'],
];

const ROWS = 5;
const PER_ROW = 6;
const CARD_GAP = 360;
const ROW_GAP = 150;
const EXIT0 = 1.6;
/** Rows leave in pairs from the outside in: top+bottom, then the next pair, then the middle. */
const EXIT_GROUP = [0, 1, 2, 1, 0];

function cardExit(row: number, i: number, dir: number): number {
  const lead = dir < 0 ? i : PER_ROW - 1 - i;
  return EXIT0 + EXIT_GROUP[row] * 0.95 + lead * 0.12;
}

function PeopleRow({ row }: { row: number }) {
  const dir = row % 2 ? 1 : -1;
  const fx: Animator = (t, L) => {
    const enter = seg(t, row * 0.05, 0.75 + row * 0.05, ease.std);
    return {
      x: (dir * 70 * t - dir * (1 - enter) * 900 + (row % 2 ? -150 : 0)) * sc(L),
      y: (row - (ROWS - 1) / 2) * ROW_GAP * sc(L),
      s: sc(L),
      o: enter,
    };
  };
  return (
    <Fx className="fl-prow" fx={fx}>
      {Array.from({ length: PER_ROW }, (_, i) => {
        const [name, why, icon] = PEOPLE[(row * 5 + i * 7) % PEOPLE.length];
        const te = cardExit(row, i, dir);
        const card: Animator = (t) => {
          const k = seg(t, te, te + 0.5, ease.inCubic);
          return { x: dir * 1700 * k, blur: k * 10, o: 1 - seg(t, te + 0.3, te + 0.5), rz: dir * 4 * k };
        };
        return (
          <Fx key={i} anchor={false} className="fl-pcard" style={{ left: (i - (PER_ROW - 1) / 2) * CARD_GAP }} fx={card}>
            <span className="fl-pcard-av" style={{ ['--hue' as string]: Math.round(rand(row * 9 + i) * 360) }}>
              {name[0]}
            </span>
            <span className="fl-pcard-body">
              <span className="fl-pcard-name">{name}</span>
              <span className="fl-pcard-why">
                <Icon name={icon} size={15} />
                {why}
              </span>
            </span>
          </Fx>
        );
      })}
    </Fx>
  );
}

/* ---------------- A': the opening line, set over the cards ---------------- */

/** One word of the opening line: `big` words carry the meaning, the rest sit lighter. */
interface TitleWord {
  w: string;
  big?: boolean;
  /** Seconds after T0 that the word lands. */
  at: number;
}

const T0 = 0.15;
const T_OUT = 3.0;
const T_END = 3.4;
const TITLE: readonly (readonly TitleWord[])[] = [
  [
    { w: 'Somewhere', at: 0.0 },
    { w: 'out', at: 0.16 },
    { w: 'there,', at: 0.3 },
  ],
  [
    { w: 'someone', at: 0.62 },
    { w: 'cares', big: true, at: 0.86 },
  ],
  [
    { w: 'about the things', at: 1.3 },
    { w: 'you do.', big: true, at: 1.58 },
  ],
];

function OpeningTitle() {
  const wrap: Animator = (t, L) => {
    const q = seg(t, T_OUT, T_END, ease.exit);
    return { s: (1 + 0.035 * seg(t, T0, T_END, ease.linear)) * sc(L), y: -q * 26, o: 1 - q, blur: q * 14 };
  };
  const veil: Animator = (t) => ({ o: seg(t, 0, 0.45, ease.std) * (1 - seg(t, T_OUT, T_END + 0.1)) });
  return (
    <>
      <Fx anchor={false} className="fl-full fl-ot-veil" fx={veil} />
      <Fx className="fl-ot" fx={wrap}>
        {TITLE.map((line, li) => (
          <span key={li} className="fl-ot-line">
            {line.map(({ w, big, at }) => {
              const fx: Animator = (t) => {
                const k = seg(t, T0 + at, T0 + at + (big ? 0.7 : 0.5), big ? ease.outExpo : ease.std);
                const sheen = seg(t, T0 + at + 0.25, T0 + at + 1.35, ease.inOutCubic);
                return {
                  y: (1 - k) * (big ? 46 : 26),
                  s: big ? 0.86 + 0.14 * k : 1,
                  o: k,
                  blur: (1 - k) * (big ? 18 : 10),
                  vars: { '--sheen': `${(-30 + 160 * sheen).toFixed(1)}%`, '--track': `${((1 - k) * 0.08).toFixed(3)}em` },
                };
              };
              return (
                <Fx key={w} as="span" anchor={false} className={`fl-ot-w${big ? ' fl-ot-w--big' : ''}`} fx={fx}>
                  {w}
                </Fx>
              );
            })}
          </span>
        ))}
      </Fx>
    </>
  );
}

function SceneCards() {
  return (
    <Shot range={[0, 4.7]}>
      <div className="fl-full fl-macro-light" />
      <div className="fl-full fl-prows">
        {Array.from({ length: ROWS }, (_, r) => (
          <PeopleRow key={r} row={r} />
        ))}
      </div>
      <Shot range={[0, T_END + 0.15]}>
        <OpeningTitle />
      </Shot>
    </Shot>
  );
}

/* ---------------- B: intent chips flowing inside one glass pill ---------------- */

const CHIPS: ReadonlyArray<readonly [string, IconName]> = [
  ['Friends', 'users'],
  ['Learn', 'book'],
  ['Hobbies', 'music'],
  ['Mentor', 'spark'],
];
const B0 = 4.6;
const B_OUT = 5.85;
const SEL_AT = 5.12;

function SceneChips() {
  const bg: Animator = (t) => ({ o: seg(t, B0, B0 + 0.3, ease.std), vars: { '--drift': `${((t - B0) * 18).toFixed(1)}px` } });
  // The pill glides in from the right, eases through the frame, then glides out left: one continuous flow.
  const group: Animator = (t, L) => {
    const k = seg(t, B0, B0 + 0.75, ease.std);
    const out = seg(t, B_OUT, B_OUT + 0.9, ease.exit);
    const drift = seg(t, B0, B_OUT + 0.9, ease.linear);
    return {
      x: (lerp(760, 60, k) - 40 * drift - 1500 * out) * sc(L),
      y: (lerp(130, 10, k) + 120 * out) * sc(L),
      rz: lerp(-7, -4, k) - 3 * out,
      s: 1.75 * sc(L),
      blur: (1 - k) * 10 + out * 14,
      o: seg(t, B0, B0 + 0.2) * (1 - seg(t, B_OUT + 0.6, B_OUT + 0.9)),
    };
  };
  const pill: Animator = (t) => {
    const k = seg(t, B0 + 0.05, B0 + 0.6, ease.std);
    return { sx: 0.18 + 0.82 * k, o: Math.min(1, k * 3), vars: { '--glint': `${(-40 + 180 * seg(t, B0 + 0.5, B_OUT, ease.inOutCubic)).toFixed(1)}%` } };
  };
  // The Rendly badge sits inside the pill's left end and turns once as the pill lands.
  const badge: Animator = (t) => {
    const k = seg(t, B0 + 0.2, B0 + 0.65, ease.spring);
    return { s: 0.3 + 0.7 * k, o: Math.min(1, k * 2), rz: lerp(-180, 0, seg(t, B0 + 0.2, B0 + 0.8, ease.std)) };
  };
  const ring: Animator = (t) => ({ rz: (t - B0) * 120, o: seg(t, B0 + 0.4, B0 + 0.7) * 0.9 });
  return (
    <Shot range={[B0, B_OUT + 0.95]}>
      <Fx anchor={false} className="fl-full fl-gdark" fx={bg} />
      <Fx className="fl-cwrap fl-cwrap--dark" fx={group}>
        <Fx as="span" anchor={false} className="fl-cwrap-pill" fx={pill} />
        <Fx as="span" anchor={false} className="fl-cwrap-badge" fx={badge}>
          <Fx as="span" anchor={false} className="fl-cwrap-ring" fx={ring} />
          <RendlyMark className="fl-cwrap-mark" />
        </Fx>
        <span className="fl-lchips">
          {CHIPS.map(([c, icon], i) => {
            const t0 = B0 + 0.3 + i * 0.09;
            const chip: Animator = (t) => {
              const k = seg(t, t0, t0 + 0.45, ease.spring);
              const sel = c === 'Learn' ? seg(t, SEL_AT, SEL_AT + 0.25, ease.std) : 0;
              const press = c === 'Learn' ? Math.max(0, 1 - Math.abs(t - SEL_AT) / 0.1) : 0;
              return { x: (1 - k) * 60, o: Math.min(1, k * 1.6), s: (0.9 + 0.1 * k) * (1 - 0.08 * press), vars: { '--sel': sel.toFixed(3) } };
            };
            // Each icon draws itself in with a little turn, then breathes.
            const ico: Animator = (t) => {
              const k = seg(t, t0 + 0.15, t0 + 0.6, ease.spring);
              const pulse = c === 'Learn' ? Math.max(0, 1 - Math.abs(t - SEL_AT - 0.1) / 0.25) : 0;
              return { s: (0.4 + 0.6 * k) * (1 + 0.25 * pulse + 0.04 * Math.sin((t - t0) * 6)), rz: lerp(-90, 0, k), o: Math.min(1, k * 2) };
            };
            return (
              <Fx key={c} as="span" anchor={false} className="fl-lchip fl-lchip--dark" fx={chip}>
                <Fx as="span" anchor={false} className="fl-lchip-ico" fx={ico}>
                  <Icon name={c === 'Learn' ? 'check' : icon} size={17} />
                </Fx>
                {c}
              </Fx>
            );
          })}
        </span>
      </Fx>
    </Shot>
  );
}

/* ---------------- C: the Feeds pill and the Gemini-style star ---------------- */

const C0 = 6.7;

/** The star's colours as it spins in (Gemini blue -> violet -> rose), deepening as it fills the frame. */
const STAR_KEYS: ReadonlyArray<readonly [number, readonly [string, string, string]]> = [
  [0, ['#4285f4', '#9b72cb', '#d96570']],
  [0.45, ['#3a78f0', '#8a63d2', '#c9587a']],
  [0.8, ['#2350c4', '#5a3fb4', '#86306a']],
  [1, ['#0d1f5a', '#1d1650', '#2a1240']],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a: string, b: string, k: number) => {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(' ')})`;
};

function starColors(k: number): readonly [string, string, string] {
  let i = 1;
  while (i < STAR_KEYS.length - 1 && k > STAR_KEYS[i][0]) i += 1;
  const [k0, c0] = STAR_KEYS[i - 1];
  const [k1, c1] = STAR_KEYS[i];
  const f = Math.min(1, Math.max(0, (k - k0) / (k1 - k0)));
  return [mixHex(c0[0], c1[0], f), mixHex(c0[1], c1[1], f), mixHex(c0[2], c1[2], f)];
}

/** The Gemini sparkle: four concave points, gradient stops following --sa/--sb/--sc. */
function GradientStar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="fl-gstar">
      <defs>
        <linearGradient id="fl-gstar-fill" x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--sa, #4285f4)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--sb, #9b72cb)' }} />
          <stop offset="1" style={{ stopColor: 'var(--sc, #d96570)' }} />
        </linearGradient>
      </defs>
      <path d="M12 0C12 6.63 17.37 12 24 12C17.37 12 12 17.37 12 24C12 17.37 6.63 12 0 12C6.63 12 12 6.63 12 0Z" fill="url(#fl-gstar-fill)" />
    </svg>
  );
}
const STAR0 = 7.2;
const STAR_LEN = 1.05;

function SceneStar() {
  const bg: Animator = (t) => ({ vars: { '--drift': `${((t - C0) * 18).toFixed(1)}px` } });
  const pill: Animator = (t, L) => {
    const k = seg(t, C0, C0 + 0.4, ease.spring);
    return { s: (0.7 + 0.3 * k) * 2.6 * sc(L), o: seg(t, C0, C0 + 0.12) };
  };
  const label: Animator = (t) => ({ o: 1 - seg(t, STAR0 + 0.05, STAR0 + 0.3) });
  const shell: Animator = (t) => ({ o: 1 - seg(t, STAR0 + 0.08, STAR0 + 0.35) });
  // Two tumbles, then it fills the frame: first diagonally (X with Z), then vertically (Y with X),
  // ending face-on as it grows past the edges. The glow behind it swells with it.
  const star: Animator = (t) => {
    const k = seg(t, STAR0, STAR0 + STAR_LEN, ease.linear);
    const a = ease.inOutCubic(seg(k, 0, 0.48));
    const b = ease.inOutCubic(seg(k, 0.4, 0.9));
    const grow = ease.inCubic(seg(k, 0.15, 1));
    const [c1, c2, c3] = starColors(ease.inOutCubic(k));
    return {
      rx: 180 * a + 180 * b,
      ry: 360 * b,
      rz: 180 * a + 45 * b,
      s: 1 + 2.2 * a + 80 * Math.pow(grow, 2.6),
      o: 1 - seg(t, STAR0 + STAR_LEN - 0.14, STAR0 + STAR_LEN),
      vars: { '--sa': c1, '--sb': c2, '--sc': c3 },
    };
  };
  const halo: Animator = (t, L) => {
    const k = seg(t, STAR0, STAR0 + STAR_LEN, ease.inCubic);
    // Centred on the star, which sits at the pill's left end.
    return { x: -122 * sc(L), y: 4 * sc(L), s: 1 + 6 * k, o: seg(t, STAR0, STAR0 + 0.3) * 0.9 * (1 - seg(t, STAR0 + STAR_LEN - 0.2, STAR0 + STAR_LEN)) };
  };
  return (
    <Shot range={[C0, STAR0 + STAR_LEN + 0.02]}>
      <Fx anchor={false} className="fl-full fl-gdark" fx={bg} />
      <Fx className="fl-starhalo" fx={halo} />
      <Fx className="fl-starpill fl-starpill--dark" fx={pill}>
        <Fx as="span" anchor={false} className="fl-starpill-bg" fx={shell} />
        <Fx as="span" anchor={false} className="fl-starpill-star" fx={star}>
          <GradientStar />
        </Fx>
        <Fx as="span" anchor={false} className="fl-starpill-label" fx={label}>
          Feeds
        </Fx>
      </Fx>
    </Shot>
  );
}

/* ---------------- D: the toggle and its glowing outline ---------------- */

const D0 = 8.05;
const DRAW0 = 8.6;
const DRAW1 = 9.5;
const BURST0 = 9.6;
const BURST1 = 10.45;
/** Outline path round the 300x64 toggle (12px margin), starting bottom-left. */
const TRACE = 'M44 87 H280 A43 43 0 0 0 280 1 H44 A43 43 0 0 0 44 87 Z';
const RINGS: ReadonlyArray<readonly [number, number]> = [
  [0, 7],
  [0.12, 10],
  [0.24, 13],
];

function SceneToggle() {
  const dark: Animator = (t) => ({ o: seg(t, 7.95, 8.2) });
  const pill: Animator = (t, L) => {
    const k = seg(t, D0, D0 + 0.4, ease.spring);
    const out = seg(t, BURST0, BURST0 + 0.45, ease.exit);
    return { s: (0.85 + 0.15 * k) * (1 - 0.06 * out) * 2.6 * sc(L), o: seg(t, D0, D0 + 0.15) * (1 - out) };
  };
  const ring =
    (delay: number, reach: number): Animator =>
    (t, L) => {
      const k = seg(t, BURST0 + delay, BURST1, ease.outCubic);
      const draw = seg(t, DRAW0, DRAW1, ease.inOutCubic);
      const shown = delay === 0 || t >= BURST0 + delay ? 1 : 0;
      return {
        s: (1 + reach * k) * 2.6 * sc(L),
        o: shown * (1 - seg(t, BURST0 + delay + 0.25, BURST1)),
        vars: { '--draw': draw.toFixed(4) },
      };
    };
  return (
    <Shot range={[7.9, BURST1 + 0.05]}>
      <Fx anchor={false} className="fl-full fl-macro-dark" fx={dark} />
      <Fx className="fl-toggle fl-toggle--wide" fx={pill}>
        <span className="fl-toggle-a">
          <SparkMark size={22} />
          Feeds
        </span>
        <span className="fl-toggle-b fl-toggle-b--open">
          <RendlyMark className="fl-toggle-markimg" />
          Rendly
        </span>
      </Fx>
      {RINGS.map(([d, r]) => (
        <Fx key={d} className="fl-otrace" fx={ring(d, r)}>
          <svg viewBox="0 0 324 88" width="324" height="88" aria-hidden="true">
            <path d={TRACE} pathLength={1} className="fl-otrace-path" />
          </svg>
        </Fx>
      ))}
    </Shot>
  );
}

/* ---------------- E: the headline ---------------- */

export const HEAD = 'Your people are out there.';
const H0 = 10.4;

function Headline() {
  const fx: Animator = (t, L) => {
    const into = seg(t, H0 + 0.95, H0 + 1.5, ease.std);
    const phoneY = pick(L, 60, 80);
    return {
      y: lerp(pick(L, 40, 0), phoneY - pick(L, 205, 300), into),
      x: lerp(0, pick(L, 6, 4), into),
      s: lerp(1 + 0.06 * seg(t, H0 + 0.3, H0 + 0.95), 0.3, into) * sc(L),
      o: 1 - seg(t, H0 + 1.36, H0 + 1.5),
      vars: { '--ink': seg(t, H0 + 0.02, H0 + 0.7, ease.std).toFixed(3) },
    };
  };
  return (
    <Fx className="fl-gink" fx={fx}>
      {HEAD.split(' ').map((w, i) => {
        const wf: Animator = (t) => {
          const k = seg(t, H0 + i * 0.08, H0 + 0.45 + i * 0.08, ease.std);
          return { o: k, blur: (1 - k) * 10, y: (1 - k) * 16 };
        };
        return (
          <Fx key={w} as="span" anchor={false} className="fl-gink-w" fx={wf}>
            {w}
          </Fx>
        );
      })}
    </Fx>
  );
}

/* ---------------- F: montage (old clock, shifted) ---------------- */

interface Cut {
  name: ClipName;
  a: number;
  b: number;
  focus?: string;
}

const MONTAGE: readonly Cut[] = [
  { name: 'city', a: 4.7, b: 5.7 },
  { name: 'crowd', a: 5.7, b: 6.95, focus: '50% 70%' },
  { name: 'crossing', a: 6.95, b: 7.9 },
  { name: 'bridge', a: 7.9, b: 9.05, focus: '50% 60%' },
];

function MontageCut({ c, first }: { c: Cut; first: boolean }) {
  // The first cut irises open over 1 s after the phone has left the frame.
  const push: Animator = (t) => {
    if (!first) return { s: 1.04 + 0.07 * seg(t, c.a, c.b, ease.linear) };
    const k = seg(t, c.a, c.a + 1, ease.inOutCubic);
    return {
      s: lerp(1.3, 1.04, k) + 0.07 * seg(t, c.a, c.b, ease.linear),
      blur: (1 - k) * 12,
      bright: 0.55 + 0.45 * k,
      clip: k >= 1 ? undefined : `circle(${(8 + 70 * k).toFixed(2)}% at 50% 50%)`,
    };
  };
  return (
    <Shot range={[c.a, c.b]}>
      <Fx anchor={false} className="fl-full" fx={push}>
        <Clip name={c.name} range={[c.a, c.b]} className="fl-grade fl-grade--city" focus={c.focus} />
      </Fx>
    </Shot>
  );
}

export function ShotOpen() {
  return (
    <>
      <SceneCards />
      <SceneChips />
      <SceneStar />
      <SceneToggle />
      <Shot range={[H0 - 0.1, 28.85]} className="fl-persp">
        <div className="fl-full fl-macro-dark" />
        <PhoneSpin />
        <Shot range={[H0 - 0.1, H0 + 1.55]}>
          <Headline />
        </Shot>
      </Shot>
      <Shot range={[4.6 + OPEN_SHIFT, 9.1 + OPEN_SHIFT]} shift={OPEN_SHIFT}>
        {MONTAGE.map((c, i) => (
          <MontageCut key={c.name} c={c} first={i === 0} />
        ))}
        <Shot range={[4.7, 9.05]}>
          <div className="fl-veil fl-veil--center" />
          <Caption text="Cities full of *people*." t0={4.85} t1={6.95} from={0.7} className="fl-caption2--lg" />
          <Caption text="Feeds full of *strangers*." t0={6.95} t1={9.05} from={1.2} className="fl-caption2--lg" />
        </Shot>
      </Shot>
    </>
  );
}
