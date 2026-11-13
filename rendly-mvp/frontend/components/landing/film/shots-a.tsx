'use client';

/** Feeds and "Real connection starts with your why." Authored on the original local clock; re-timed by shifted wrappers. */

import React from 'react';
import { Clip } from './clips';
import { Fx, Shot, type Animator } from './engine';
import { KLine, circleWipe, insetWipe, pick, rise } from './kit';
import { ease, seg } from './timeline';

/* ---------------- 1. Online ---------------- */

export function ShotOnline() {
  const panel: Animator = (t, L) => {
    const k = seg(t, 1.8, 3.1, ease.std);
    const q = seg(t, 4.9, 5.6, ease.exit);
    const open = k * (1 - q);
    const [w, h] = pick(L, [560, 340], [520, 640]);
    return {
      clip: insetWipe(open, w * (1 - q * 0.5), h * (1 - q * 0.5), L.W, L.H, 28, 0),
      o: seg(t, 1.7, 2.0) * (1 - seg(t, 5.2, 5.6)),
      blur: q * 10,
    };
  };
  const push: Animator = (t) => ({ s: 1.02 + 0.08 * seg(t, 1.8, 5.6, ease.linear) });
  return (
    <Shot range={[0, 5.65]}>
      <Fx anchor={false} className="fl-full" fx={panel}>
        <Fx anchor={false} className="fl-full" fx={push}>
          <Clip name="feed" range={[1.6, 5.65]} className="fl-grade" />
        </Fx>
        <div className="fl-veil fl-veil--bottom" />
      </Fx>
      <Fx
        className="fl-kline fl-headline"
        fx={(t, L) => {
          const r = rise(t, 2.6, 5.25, 36, 0.8, 0.45);
          return { ...r, y: pick(L, 170, 300) + (r.y ?? 0), vars: { '--strike': seg(t, 3.4, 3.85, ease.std).toFixed(3) } };
        }}
      >
        Endless feeds.
        <span className="fl-strike" />
      </Fx>
    </Shot>
  );
}

/* ---------------- 2. Why ---------------- */

export function ShotWhy() {
  const paper: Animator = (t, L) => ({
    clip: circleWipe(seg(t, 5.1, 5.95, ease.std), L.W / 2, L.H / 2, Math.hypot(L.W, L.H) / 2 + 20),
  });
  const exit: Animator = (t) => {
    const q = seg(t, 8.5, 9.15, ease.exit);
    return { s: 1 - 0.06 * q, o: 1 - q };
  };
  const bar: Animator = (t, L) => {
    const r = rise(t, 6.1, 9.2, 30);
    return { x: pick(L, 185, 140), y: pick(L, 128, 100), o: r.o, sx: seg(t, 6.7, 7.5, ease.std) };
  };
  return (
    <Shot range={[5.05, 9.2]} fx={exit}>
      <Fx anchor={false} className="fl-full fl-paper" fx={paper} />
      <KLine text="Real connection starts with" t0={5.6} t1={9.2} className="fl-kicker fl-kicker--ink" y={(L) => pick(L, -96, -150)} />
      <KLine text="your why." t0={6.0} t1={9.2} className="fl-display fl-display--ink" y={(L) => pick(L, 22, -10)} />
      <Fx className="fl-whybar" fx={bar} />
      <KLine
        text="Rendly matches people on what they're here to do."
        t0={7.15}
        t1={9.2}
        className="fl-note fl-note--ink"
        y={(L) => pick(L, 210, 240)}
      />
    </Shot>
  );
}
