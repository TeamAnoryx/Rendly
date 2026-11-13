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
      <Chip t0={50.3} t1={52.5} anchor className="fl-chip--glass fl-chip--lg" x={(L) => pick(L, 150, 120)} y={(L) => pick(L, -190, -330)}>
        <SparkMark size={18} />
        Met on Rendly · shared why
      </Chip>
    </Shot>
  );
}

/* ---------------- 10. End card ---------------- */

export function ShotEnd() {
  const mark: Animator = (t) => {
    const k = seg(t, 53.0, 53.4);
    const q = seg(t, 55.3, 55.9, ease.exit);
    return { o: k * (1 - q), s: 1 + 0.05 * seg(t, 53, 55.9) + 0.06 * q, blur: q * 6 };
  };
  const lockup: Animator = (t, L) => {
    const r = rise(t, 55.5, 99, 26, 1.0);
    return { y: pick(L, -96, -150) + (r.y ?? 0), o: r.o, blur: r.blur };
  };
  const cta: Animator = (t, L) => {
    const p = pop(t, 56.9, 0.55);
    return { y: pick(L, 150, 190), s: p.s, o: p.o, live: t > 57.1 };
  };
  return (
    <Shot range={[52.9, 68.3]}>
      <Fx anchor={false} className="fl-full fl-black" fx={(t) => ({ o: seg(t, 52.9, 53.3) })} />
      <Fx className="fl-markclip" fx={mark}>
        <Clip name="mark" range={[52.9, 56]} offset={0} />
      </Fx>
      <Fx className="fl-lockup" fx={lockup}>
        <RendlyLockup className="fl-lockup-img" tone="white" />
      </Fx>
      <Fx className="fl-tagline" fx={(t, L) => ({ y: pick(L, 22, 10) })}>
        <Words text="Know your why." t0={56.0} size={64} className="fl-tagline-a" />
        <span className="fl-tagline-gap"> </span>
        <Words text="Find your who." t0={56.35} size={64} className="fl-tagline-b" accent={2} />
      </Fx>
      <Fx as="a" href="/auth/sign-up" className="fl-btn fl-btn--cta" fx={cta} tabIndex={-1}>
        Get started
        <Icon name="arrow" size={18} />
      </Fx>
    </Shot>
  );
}
