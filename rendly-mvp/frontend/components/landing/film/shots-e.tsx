'use client';

/** The real-life payoff and the end card. Authored on the original local clock; re-timed by shifted wrappers. */

import React from 'react';
import { RendlyLockup } from '@/components/brand/Brand';
import { Clip } from './clips';
import { Fx, Shot, type Animator } from './engine';
import { Chip, KLine, circleWipe, pick, pop, rise } from './kit';
import { Icon, SparkMark, Words } from './primitives';
import { ease, seg } from './timeline';

/* ---------------- 9. Real life ---------------- */

export function ShotReal() {
  const reveal: Animator = (t, L) => ({
    clip: circleWipe(seg(t, 45.85, 46.9, ease.std), L.W / 2, L.H / 2, Math.hypot(L.W, L.H) / 2 + 20),
    o: 1 - seg(t, 52.5, 53.3),
  });
  const push: Animator = (t) => ({ s: 1.04 + 0.08 * seg(t, 45.85, 53.3, ease.linear) });
  return (
    <Shot range={[45.8, 53.35]}>
      <Fx anchor={false} className="fl-full" fx={reveal}>
        <Fx anchor={false} className="fl-full" fx={push}>
          <Clip name="cafe" range={[45.8, 53.35]} className="fl-grade fl-grade--warm" focus="45% 40%" />
        </Fx>
        <div className="fl-veil fl-veil--bottomleft" />
      </Fx>
      <div className="fl-reallines">
        <KLine text="Less scrolling." t0={47.1} t1={52.6} anchor={false} className="fl-headline" />
        <KLine text="More meeting." t0={48.1} t1={52.6} anchor={false} className="fl-headline fl-headline--strong" />
      </div>
      <Chip t0={50.3} t1={52.5} anchor className="fl-chip--glass fl-chip--lg fl-chip--real" x={(L) => pick(L, -470, 0)} y={(L) => pick(L, -340, -520)}>
        <SparkMark size={18} />
        Met on Rendly · shared why
      </Chip>
    </Shot>
  );
}

/* ---------------- 10. End card ---------------- */

/* Local clock: played = local + 81. The mark clip plays, holds its last frame ~2 s with a slow push,
   and is fully gone before the lockup arrives. The URL holds the final 5 s (played 144-149). */
const MARK_HOLD_END = 57.3;
const MARK_GONE = 57.85;
const LOCK_IN = 57.95;
const TAG_A = 58.35;
const TAG_B = 58.75;
const CTA_IN = 59.5;
const URL_IN = 63.0;
const SITE_URL = 'https://anoryxtechsolutions.com/rendly.app';

export function ShotEnd() {
  const mark: Animator = (t) => {
    const k = seg(t, 53.0, 53.4);
    const q = seg(t, MARK_HOLD_END, MARK_GONE, ease.inOutCubic);
    return { o: k * (1 - q), s: 1 + 0.06 * seg(t, 53, MARK_HOLD_END) + 0.08 * q, blur: q * 10 };
  };
  const glow: Animator = (t) => ({ o: seg(t, LOCK_IN - 0.2, LOCK_IN + 1.2, ease.std), vars: { '--drift': `${(Math.sin(t * 0.5) * 70).toFixed(1)}px` } });
  const lockup: Animator = (t, L) => {
    const r = rise(t, LOCK_IN, 99, 34, 1.5);
    const k = seg(t, LOCK_IN, LOCK_IN + 1.5, ease.outCubic);
    return { y: pick(L, -96, -150) + (r.y ?? 0), o: r.o, blur: r.blur, s: 0.94 + 0.06 * k };
  };
  const cta: Animator = (t, L) => {
    const p = pop(t, CTA_IN, 0.8);
    return { y: pick(L, 150, 190), s: p.s, o: p.o, live: t > CTA_IN + 0.3 };
  };
  const url: Animator = (t, L) => {
    const k = seg(t, URL_IN, URL_IN + 0.9, ease.outCubic);
    return { y: pick(L, 368, 520) + (1 - k) * 18, o: k, blur: (1 - k) * 6, vars: { '--sheen': `${(-30 + 170 * seg(t, URL_IN + 0.6, URL_IN + 2.2)).toFixed(1)}%` } };
  };
  return (
    <Shot range={[52.9, 68.3]}>
      <Fx anchor={false} className="fl-full fl-black" fx={(t) => ({ o: seg(t, 52.9, 53.3) })} />
      <Fx className="fl-markclip" fx={mark}>
        <Clip name="mark" range={[52.9, MARK_GONE + 0.1]} offset={0} />
      </Fx>
      <Fx anchor={false} className="fl-full fl-gdark fl-end-bg" fx={glow} />
      <Fx className="fl-lockup" fx={lockup}>
        <RendlyLockup className="fl-lockup-img" tone="white" />
      </Fx>
      <Fx className="fl-tagline" fx={(t, L) => ({ y: pick(L, 22, 10) })}>
        <Words text="Know your why." t0={TAG_A} size={64} className="fl-tagline-a" />
        <span className="fl-tagline-gap"> </span>
        <Words text="Find your who." t0={TAG_B} size={64} className="fl-tagline-b" accent={2} />
      </Fx>
      <Fx as="a" href="/auth/sign-up" className="fl-btn fl-btn--cta" fx={cta} tabIndex={-1}>
        Get started
        <Icon name="arrow" size={18} />
      </Fx>
      <Fx className="fl-end-url" fx={url}>
        <span className="fl-end-url-k">Visit</span>
        <span className="fl-end-url-v">{SITE_URL}</span>
      </Fx>
    </Shot>
  );
}
