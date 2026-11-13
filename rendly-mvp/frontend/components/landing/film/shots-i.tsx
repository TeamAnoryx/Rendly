'use client';

/**
 * Real life and the close. A sunset beat (authored at 75.8 s, re-timed by
 * SHIFT.offline) leads into the café; after it, the Golden Gate drive
 * bookends the opening line ("Your people are out there."), and on the end
 * card the reasons people come to Rendly keep cycling under the CTA.
 */

import React from 'react';
import { Clip } from './clips';
import { Fx, Shot, type Animator } from './engine';
import { Caption } from './kit2';
import { pick } from './kit';
import { Icon, type IconName } from './primitives';
import { ease, seg } from './timeline';

/* ---------------- Sunset: then take it offline (local 75.8-78.45) ---------------- */

export function ShotOffline() {
  // Comes in out of focus and settles while the huddle dissolves over it.
  const push: Animator = (t) => {
    const k = seg(t, 75.75, 76.75, ease.std);
    return { s: (1.03 + 0.08 * seg(t, 75.8, 78.4, ease.linear)) * (1 + 0.14 * (1 - k)), blur: 12 * (1 - k), o: seg(t, 75.75, 76.3) };
  };
  return (
    <Shot range={[75.7, 78.45]}>
      <Fx anchor={false} className="fl-full" fx={push}>
        <Clip name="sunset" range={[75.8, 78.45]} className="fl-grade fl-grade--warm" focus="50% 55%" />
      </Fx>
      <div className="fl-veil fl-veil--center" />
      <Caption text="Saturday. Take it *offline*." t0={76.0} t1={78.3} from={0.65} className="fl-caption2--lg" />
    </Shot>
  );
}

/* ---------------- Out there (film time) ---------------- */

export const OUT_A = 102.75;
export const OUT_B = 104.75;

export function ShotOutThere() {
  const fx: Animator = (t) => {
    const k = seg(t, OUT_A, OUT_A + 0.4, ease.std);
    return { clip: `inset(${((1 - k) * 50).toFixed(1)}% 0 ${((1 - k) * 50).toFixed(1)}% 0)`, s: 1.04 + 0.06 * seg(t, OUT_A, OUT_B), o: 1 - seg(t, OUT_B - 0.3, OUT_B) };
  };
  return (
    <Shot range={[OUT_A, OUT_B + 0.05]}>
      <Fx anchor={false} className="fl-full" fx={fx}>
        <Clip name="gate" range={[OUT_A, OUT_B + 0.05]} className="fl-grade fl-grade--city" focus="50% 50%" />
        <div className="fl-veil fl-veil--center" />
      </Fx>
      <Caption text="Your people are *out there*." t0={OUT_A + 0.2} t1={OUT_B} from={0.7} className="fl-caption2--lg" />
    </Shot>
  );
}

/* ---------------- End card: reasons cycling under the CTA ---------------- */

const REASONS: ReadonlyArray<readonly [IconName, string]> = [
  ['users', 'Friends'],
  ['book', 'Learn'],
  ['code', 'Build'],
  ['music', 'Hobbies'],
  ['spark', 'Mentor'],
  ['rocket', 'Hiring'],
  ['globe', 'Collaborate'],
];

export function ShotEndReasons() {
  const start = 109.4;
  const step = 1.3;
  return (
    <Shot range={[start, 120]}>
      {REASONS.map(([icon, label], i) => {
        const a = start + i * step;
        const fx: Animator = (t, L) => {
          const cyc = REASONS.length * step;
          const loopT = a + Math.floor(Math.max(0, t - a) / cyc) * cyc;
          const k = seg(t, loopT, loopT + 0.35, ease.spring);
          const q = seg(t, loopT + step - 0.25, loopT + step, ease.exit);
          const on = t >= a ? 1 : 0;
          return { y: pick(L, 275, 330) + (1 - k) * 14 - q * 14, s: 0.9 + 0.1 * k, o: on * Math.min(1, k * 1.6) * (1 - q) };
        };
        return (
          <Fx key={label} className="fl-reason" fx={fx}>
            <Icon name={icon} size={16} />
            {label}
          </Fx>
        );
      })}
    </Shot>
  );
}
