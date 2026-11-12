'use client';

import React from 'react';
import { faceCrop } from '../photos';
import type { CastMember } from './cast';
import { Fx, type Animator } from './engine';
import { ease, seg } from './timeline';

/* ---------------- Shot envelopes ---------------- */

/** Fade-and-settle in over [a, a+fi], fade-and-lift out over [b-fo, b]. */
export function enter(t: number, a: number, b: number, fi = 0.9, fo = 0.6) {
  const k = seg(t, a, a + fi, ease.std);
  const q = seg(t, b - fo, b, ease.exit);
  return { k, q, o: k * (1 - q) };
}

/* ---------------- Type ---------------- */

export interface WordsProps {
  text: string;
  t0: number;
  /** Exit start, if the words leave before the shot ends. */
  t1?: number;
  stagger?: number;
  dur?: number;
  /** Font size in canvas px, used for travel distance. */
  size: number;
  className?: string;
  /** Index of the one word drawn with the accent gradient. */
  accent?: number;
}

/** Word-by-word masked reveal: each word rises out of its own mask. */
export function Words({ text, t0, t1, stagger = 0.07, dur = 1.1, size, className = '', accent }: WordsProps) {
  const words = text.split(' ');
  return (
    <span className={`fl-words ${className}`}>
      {words.map((w, i) => {
        const fx: Animator = (t) => {
          const k = seg(t, t0 + i * stagger, t0 + i * stagger + dur, ease.std);
          let y = (1 - k) * size * 0.9;
          let o = Math.min(1, k * 1.4);
          if (t1 !== undefined) {
            const q = seg(t, t1 + i * 0.03, t1 + i * 0.03 + 0.5, ease.exit);
            y -= q * size * 0.35;
            o *= 1 - q;
          }
          return { y, o };
        };
        return (
          <React.Fragment key={`${w}-${i}`}>
            <span className="fl-mask">
              <Fx as="span" anchor={false} className={`fl-word${i === accent ? ' fl-grad' : ''}`} fx={fx}>
                {w}
              </Fx>
            </span>
            {i < words.length - 1 ? ' ' : null}
          </React.Fragment>
        );
      })}
    </span>
  );
}

/* ---------------- People ---------------- */

export interface FaceProps {
  who: CastMember;
  /** Box aspect (width / height). */
  aspect?: number;
  className?: string;
  /** Zoom out from the tight face crop (1 = registry crop). */
  loosen?: number;
}

/** A photo framed on one face, covering its box with no empty edges. */
export function Face({ who, aspect = 1, className = '', loosen = 1 }: FaceProps) {
  const face = { ...who.face, w: Math.min(1, who.face.w * loosen) };
  const c = faceCrop(face, who.photo.ratio, aspect);
  return (
    <span className={`fl-face ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- framed crop inside an animated layer */}
      <img
        src={who.photo.src}
        alt=""
        draggable={false}
        decoding="async"
        style={{ width: `${c.width}%`, left: `${c.left}%`, top: `${c.top}%` }}
      />
    </span>
  );
}

/* ---------------- Icons: one outlined set, 1.5px stroke on a 24 grid ---------------- */

export type IconName =
  | 'spark'
  | 'send'
  | 'mic'
  | 'video'
  | 'captions'
  | 'end'
  | 'chat'
  | 'users'
  | 'leaf'
  | 'code'
  | 'rocket'
  | 'plus'
  | 'arrow'
  | 'check'
  | 'more'
  | 'smile';

const PATHS: Record<IconName, React.ReactNode> = {
  spark: <path d="M12 3c.5 4.6 2.4 6.5 7 7-4.6.5-6.5 2.4-7 7-.5-4.6-2.4-6.5-7-7 4.6-.5 6.5-2.4 7-7Z" />,
  send: <path d="M5 12h12M12 6l6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="m15.5 10.5 5-2.8v8.6l-5-2.8" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M10.5 10.3a2.2 2.2 0 1 0 0 3.4M17 10.3a2.2 2.2 0 1 0 0 3.4" />
    </>
  ),
  end: <path d="M3.5 13.8c4.8-4.4 12.2-4.4 17 0l-2.3 2.4-3.1-1.6v-2.2a9 9 0 0 0-6.2 0v2.2l-3.1 1.6Z" />,
  chat: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5M15.5 5.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.6.7 2.7 2.3 3 4.7" />
    </>
  ),
  leaf: <path d="M5 19c0-8 5-13.5 14-14 .2 9-5 14-12.5 14.2M5 19l7-7" />,
  code: <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5M13.5 5l-3 14" />,
  rocket: (
    <>
      <path d="M12.5 15.5 8.5 11.5C10 6.5 13.5 4 19.5 4.5 20 10.5 17.5 14 12.5 15.5Z" />
      <path d="M8.5 11.5H5l2.5-3.5h4M12.5 15.5V19l3.5-2.5v-4M6 18c.3-1.4 1-2.2 2-2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  more: (
    <>
      <circle cx="6" cy="12" r=".8" />
      <circle cx="12" cy="12" r=".8" />
      <circle cx="18" cy="12" r=".8" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9.5 9.8v.4M14.5 9.8v.4" />
    </>
  ),
};

export function Icon({ name, size = 22, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`fl-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Rendly's spark: the one filled glyph, drawn in the accent gradient. */
export function SparkMark({ size = 28 }: { size?: number }) {
  const id = `fl-spark-${React.useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="fl-sparkmark">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8AB4F8" />
          <stop offset="1" stopColor="#C58AF9" />
        </linearGradient>
      </defs>
      <path d="M12 2.5c.6 5.4 2.9 7.8 8.5 8.5-5.6.7-7.9 3.1-8.5 8.5-.6-5.4-2.9-7.8-8.5-8.5 5.6-.7 7.9-3.1 8.5-8.5Z" fill={`url(#${id})`} />
    </svg>
  );
}
