'use client';

/**
 * Chapter 6 (37.6-45.6 s): why Rendly is different. Three short, factual
 * contrasts between what familiar apps are built around and what Rendly is
 * built around, with their logos as small white glyphs (a soft brand-colour
 * glow as each appears). Then every glyph joins one orbit, which collapses
 * into the white Rendly mark: the centre of the matching radar that follows.
 */

import React from 'react';
import { RendlyMark } from '@/components/brand/Brand';
import { Clip } from './clips';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Aurora, Caption } from './kit2';
import { pick } from './kit';
import { LOGOS, type LogoId } from './logos';
import { Icon, type IconName } from './primitives';
import { clamp, ease, lerp, seg } from './timeline';

const A = 37.6;
const B = 45.65;
const ORBIT = 44.2;
const COLLAPSE = 44.85;

interface Contrast {
  a: number;
  b: number;
  logos: readonly LogoId[];
  them: string;
  us: string;
  icon: IconName;
}

const CONTRASTS: readonly Contrast[] = [
  { a: 38.1, b: 40.25, logos: ['instagram', 'tiktok', 'snapchat'], them: 'Feeds, likes and endless scrolling', us: 'Real conversations, face to face', icon: 'video' },
  { a: 40.25, b: 42.3, logos: ['whatsapp', 'telegram', 'x'], them: 'Chats, DMs and replies', us: 'People matched on why they’re here', icon: 'users' },
  { a: 42.3, b: 44.25, logos: ['linkedin', 'facebook'], them: 'Profiles, resumes and networks', us: 'Your why, not your resume', icon: 'spark' },
];

const ALL: readonly LogoId[] = ['instagram', 'tiktok', 'snapchat', 'whatsapp', 'telegram', 'x', 'linkedin', 'facebook'];

/** Columns: what they are built around (left) and Rendly (right). */
const LEFT = (L: Layout) => pick(L, { x: -380, y: 40 }, { x: 0, y: -170 });
const RIGHT = (L: Layout) => pick(L, { x: 420, y: 40 }, { x: 0, y: 330 });

function Glyph({ id }: { id: LogoId }) {
  const logo = LOGOS[id];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="fl-logo-svg">
      <path d={logo.path} fill="#fff" />
    </svg>
  );
}

/** One logo tile during its contrast beat, then in the orbit, then collapsing. */
function LogoTile({ id }: { id: LogoId }) {
  const c = CONTRASTS.find((k) => k.logos.includes(id));
  const slot = c ? c.logos.indexOf(id) : 0;
  const n = c ? c.logos.length : 1;
  const orbitIdx = ALL.indexOf(id);
  const fx: Animator = (t, L) => {
    const left = LEFT(L);
    const gap = 150;
    const bx = left.x + (slot - (n - 1) / 2) * gap;
    const by = left.y - 80;
    const inK = c ? seg(t, c.a + 0.1 + slot * 0.12, c.a + 0.55 + slot * 0.12, ease.spring) : 0;
    const swept = c ? seg(t, c.b - 0.25, c.b + 0.2, ease.std) : 0;
    const back = seg(t, ORBIT, ORBIT + 0.5, ease.std);
    const spin = (t - ORBIT) * 1.6 + (orbitIdx / ALL.length) * Math.PI * 2;
    const col = seg(t, COLLAPSE, COLLAPSE + 0.5, ease.inCubic);
    const r = pick(L, 300, 260) * (1 - col);
    const ox = Math.cos(spin) * r;
    const oy = Math.sin(spin) * r * 0.55;
    // Before the orbit: own beat (pop in, then swept aside). In the orbit: ring around centre.
    const sweptX = bx - pick(L, 420, 0) * swept;
    const sweptY = by - pick(L, 0, 260) * swept;
    const beatO = clamp(inK * 1.4) * (1 - swept);
    return {
      x: lerp(sweptX, ox, back),
      y: lerp(sweptY, oy, back),
      s: lerp(0.6 + 0.4 * inK, 0.8 * (1 - 0.7 * col), back) * pick(L, 1, 0.9),
      o: Math.max(beatO * (1 - back), back * (1 - seg(t, COLLAPSE + 0.35, COLLAPSE + 0.55))),
      blur: swept * 8 * (1 - back) + col * 4,
      vars: { '--glow': (1 - seg(t, (c?.a ?? 0) + 0.7, (c?.a ?? 0) + 1.6)).toFixed(3) },
    };
  };
  return (
    <Fx className="fl-logo" fx={fx} style={{ '--brand': LOGOS[id].color } as React.CSSProperties}>
      <Glyph id={id} />
    </Fx>
  );
}

function ContrastText({ c }: { c: Contrast }) {
  const them: Animator = (t, L) => {
    const k = seg(t, c.a + 0.2, c.a + 0.6, ease.std);
    const q = seg(t, c.b - 0.3, c.b, ease.exit);
    const p = LEFT(L);
    return { x: p.x, y: p.y + 70, s: (0.85 + 0.15 * k) * (1 - 0.2 * q), o: k * (1 - q), blur: (1 - k) * 6 + q * 4 };
  };
  const us: Animator = (t, L) => {
    const k = seg(t, c.a + 0.4, c.a + 1.1, ease.spring);
    const q = seg(t, c.b - 0.3, c.b, ease.exit);
    const p = RIGHT(L);
    return { x: p.x, y: p.y, s: (0.8 + 0.2 * k) * (1 - 0.15 * q), o: clamp(k * 1.5) * (1 - q), blur: q * 4 };
  };
  return (
    <>
      <Fx className="fl-them" fx={them}>
        {c.them}
      </Fx>
      <Fx className="fl-us fl-card" fx={us}>
        <span className="fl-us-icon">
          <Icon name={c.icon} size={22} />
        </span>
        <span className="fl-us-text">
          <span className="fl-us-kicker">Rendly</span>
          {c.us}
        </span>
      </Fx>
    </>
  );
}

/** A guiding arrow drawn from the left column to the right one, once per beat. */
function Arrow() {
  const fx: Animator = (t, L) => {
    const draws = CONTRASTS.map((c) => seg(t, c.a + 0.3, c.a + 0.75, ease.std) * (1 - seg(t, c.b - 0.3, c.b)));
    const d = Math.max(...draws);
    return { y: pick(L, 40, 80), rz: pick(L, 0, 90), o: d > 0 ? 1 : 0, vars: { '--draw': d.toFixed(3) } };
  };
  return (
    <Fx className="fl-arrow" fx={fx}>
      <svg viewBox="0 0 220 40" aria-hidden="true">
        <path pathLength={1} d="M6 20 C 70 2, 150 38, 206 20" />
        <path pathLength={1} className="fl-arrow-head" d="M192 10 L208 20 L192 30" />
      </svg>
    </Fx>
  );
}

function Labels() {
  const fx = (side: 'l' | 'r'): Animator => (t, L) => {
    const k = seg(t, 37.9, 38.4, ease.std);
    const q = seg(t, ORBIT - 0.2, ORBIT + 0.2);
    const p = side === 'l' ? LEFT(L) : RIGHT(L);
    return { x: p.x, y: p.y - pick(L, 200, side === 'l' ? 190 : 120), o: k * (1 - q) };
  };
  return (
    <>
      <Fx className="fl-collabel" fx={fx('l')}>
        Built around
      </Fx>
      <Fx className="fl-collabel fl-collabel--us" fx={fx('r')}>
        Rendly is built around
      </Fx>
    </>
  );
}

function CenterMark() {
  const fx: Animator = (t) => {
    const k = seg(t, COLLAPSE + 0.2, COLLAPSE + 0.65, ease.spring);
    const q = seg(t, B - 0.3, B, ease.std);
    return { s: (0.2 + 0.8 * k) * (1 - 0.4 * q), o: clamp(k * 2) * (1 - q), vars: { '--halo': (k * (1 - q)).toFixed(3) } };
  };
  return (
    <Fx className="fl-centermark" fx={fx}>
      <RendlyMark className="fl-centermark-img" />
    </Fx>
  );
}

export function ShotDifferent() {
  const footage: Animator = (t) => ({ o: 0.32 * seg(t, A, A + 0.4) * (1 - seg(t, 39.0, 39.6)), s: 1.05 + 0.05 * seg(t, A, 39.6) });
  return (
    <Shot range={[A, B]}>
      <Fx anchor={false} className="fl-full" fx={footage}>
        <Clip name="alone" range={[A, 39.6]} className="fl-grade" focus="50% 40%" />
      </Fx>
      <Aurora a={A} b={B} className="fl-aurora--soft" />
      <Caption text="Most apps are built for *attention*." t0={37.65} t1={39.7} from={0.7} y={(L) => pick(L, -330, -500)} />
      <Caption text="Rendly is built for *meeting*." t0={ORBIT} t1={B} from={1.2} y={(L) => pick(L, -330, -500)} className="fl-caption2--md" />
      <Labels />
      <Arrow />
      {CONTRASTS.map((c) => (
        <ContrastText key={c.a} c={c} />
      ))}
      {ALL.map((id) => (
        <LogoTile key={id} id={id} />
      ))}
      <CenterMark />
    </Shot>
  );
}
