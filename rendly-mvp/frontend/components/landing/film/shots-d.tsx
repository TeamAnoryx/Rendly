'use client';

/** A live Spark video call (authored on the original local clock; re-timed by SHIFT.meet). */

import React from 'react';
import { Clip } from './clips';
import { Fx, Shot, type Animator } from './engine';
import { TypedText, circleWipe, pick, pop } from './kit';
import { Icon } from './primitives';
import { CAPTIONS, ease, seg, typedEnd } from './timeline';

const CALL_IN = 27.2;

function Timer({ from }: { from: number }) {
  const fx: Animator = (t) => {
    const s = Math.max(0, Math.floor(t - from));
    return { text: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` };
  };
  return <Fx as="span" anchor={false} className="fl-timer" fx={fx} />;
}

function Wave({ bars = 5, phase = 0 }: { bars?: number; phase?: number }) {
  return (
    <span className="fl-wave">
      {Array.from({ length: bars }, (_, i) => {
        const fx: Animator = (t) => {
          const v = 0.3 + 0.7 * Math.abs(Math.sin(t * 7.3 + i * 1.7 + phase) * Math.sin(t * 2.1 + i));
          return { sy: v };
        };
        return <Fx key={i} as="span" anchor={false} className="fl-wave-bar" fx={fx} />;
      })}
    </span>
  );
}

/* ---------------- 6. Spark call ---------------- */

export function ShotSpark() {
  const reveal: Animator = (t, L) => ({
    clip: circleWipe(seg(t, 26.35, 27.3, ease.std), L.W / 2, L.H / 2 + pick(L, 345, 330), Math.hypot(L.W, L.H)),
  });
  const tile: Animator = (t, L) => {
    const k = seg(t, 26.6, 27.6, ease.std);
    // Exit: the call shrinks away and tilts back as Whispers takes over.
    const q = seg(t, 33.05, 33.85, ease.exit);
    return {
      x: -pick(L, 160, 0) * q,
      ry: 18 * q,
      s: (0.94 + 0.06 * k + 0.02 * seg(t, 27.6, 33.0)) * (1 - 0.22 * q),
      o: 1 - seg(t, 33.5, 33.85),
      blur: q * 6,
    };
  };
  const pip: Animator = (t) => {
    const p = pop(t, 27.9, 0.6);
    return { s: p.s, o: p.o };
  };
  const chrome: Animator = (t) => ({ o: seg(t, 27.6, 28.1) * (1 - seg(t, 32.9, 33.3)) });
  return (
    <Shot range={[26.3, 33.9]}>
      <Fx anchor={false} className="fl-full fl-callbg" fx={reveal}>
        <Fx className="fl-calltile" fx={tile}>
          <Clip name="call" range={[26.3, 33.9]} offset={0} className="fl-grade fl-grade--call" focus="50% 30%" />
          <div className="fl-veil fl-veil--call" />
          <Fx anchor={false} className="fl-callchrome" fx={chrome}>
            <span className="fl-callchip">
              <span className="fl-live" />
              Spark
              <span className="fl-callchip-sep" />
              Jordan K.
              <Timer from={CALL_IN} />
            </span>
            <span className="fl-captions">
              {CAPTIONS.map((c, i) => {
                const next = CAPTIONS[i + 1]?.t0 ?? 33.0;
                const fx: Animator = (t) => ({
                  o: seg(t, c.t0 - 0.25, c.t0) * (1 - seg(t, next - 0.25, next - 0.05)),
                  y: (1 - seg(t, c.t0 - 0.25, c.t0 + 0.2, ease.std)) * 10,
                });
                return (
                  <Fx key={c.t0} anchor={false} className="fl-caption" fx={fx}>
                    <span className="fl-caption-who">{c.who}</span>
                    <TypedText line={c} caretUntil={typedEnd(c) + 0.1} />
                  </Fx>
                );
              })}
            </span>
            <span className="fl-dock">
              <span className="fl-dock-btn">
                <Icon name="mic" size={20} />
                <Wave />
              </span>
              <span className="fl-dock-btn">
                <Icon name="video" size={20} />
              </span>
              <span className="fl-dock-btn is-on">
                <Icon name="captions" size={20} />
              </span>
              <span className="fl-dock-btn is-end">
                <Icon name="end" size={20} />
              </span>
            </span>
          </Fx>
          <Fx anchor={false} className="fl-pip" fx={pip}>
            <Clip name="laptop-pip" range={[26.3, 33.9]} offset={0} loop className="fl-grade fl-grade--soft" />
            <span className="fl-pip-label">You</span>
          </Fx>
        </Fx>
      </Fx>
    </Shot>
  );
}
