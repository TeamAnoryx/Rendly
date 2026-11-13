'use client';

/**
 * google2's UI language for Whispers (63.7-76 s): a caption framed by growing arc
 * lines, a thread on a tilted plane, a tool rail with tooltip pops, and a
 * rail button that expands into a card. Authored in film seconds.
 */

import React from 'react';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Aurora, Caption } from './kit2';
import { Chip, Cursor, pick, pop, rise, type CursorKey } from './kit';
import { Icon, type IconName } from './primitives';
import { JORDAN_IMG } from './shots-c';
import { REPLY, ease, lerp, seg, typed, typedEnd } from './timeline';

/* ---------------- Whispers ---------------- */

const SENT = REPLY.t0 + 1.35;
const ANSWER = 69.4;
const TILT = 70.2;
const NOTE_CLICK = 71.7;
const REMIND_CLICK = 73.8;
const OUT = 75.4;

/** Plane (thread plus rail) centre, and the rail's offset from it. */
const PLANE = (L: Layout) => pick(L, { x: -120, y: 0 }, { x: -60, y: -150 });
const RAIL_DX = (L: Layout) => pick(L, 410, 360);
const RAIL_Y: readonly number[] = [-80, 0, 80];
const NOTE_AT = (L: Layout) => pick(L, { x: 540, y: -70 }, { x: 0, y: 370 });

const railPos = (L: Layout, i: number) => {
  const p = PLANE(L);
  return { x: p.x + RAIL_DX(L), y: p.y + RAIL_Y[i] };
};

interface BubbleProps {
  t0: number;
  out?: boolean;
  children: React.ReactNode;
}

function Bubble({ t0, out = false, children }: BubbleProps) {
  const fx: Animator = (t) => {
    const k = seg(t, t0, t0 + 0.45, ease.std);
    return { y: (1 - k) * 18, s: 0.94 + 0.06 * k, o: k };
  };
  return (
    <Fx anchor={false} className={`fl-bubble${out ? ' fl-bubble--out' : ''}`} fx={fx}>
      {children}
    </Fx>
  );
}

function Arcs() {
  const fx: Animator = (t) => ({
    o: 1 - seg(t, 65.6, 66.0),
    vars: { '--draw': seg(t, 63.8, 64.9, ease.std).toFixed(3) },
  });
  return (
    <Fx className="fl-arcs" fx={fx}>
      <svg viewBox="0 0 900 300" aria-hidden="true">
        <path pathLength={1} d="M40 280 C 40 90, 220 20, 450 20" />
        <path pathLength={1} d="M860 20 C 860 210, 680 280, 450 280" />
      </svg>
    </Fx>
  );
}

function Thread() {
  const composer: Animator = (t) => ({ text: t >= SENT ? '' : typed(t, REPLY) });
  const placeholder: Animator = (t) => ({ o: t < REPLY.t0 || t >= SENT + 0.1 ? 1 : 0 });
  const typing: Animator = (t) => ({ o: seg(t, SENT + 0.2, SENT + 0.3) * (1 - seg(t, ANSWER - 0.1, ANSWER)) });
  const send: Animator = (t) => {
    const press = Math.max(0, 1 - Math.abs(t - SENT) / 0.12);
    const ready = seg(t, REPLY.t0, typedEnd(REPLY)) * (1 - seg(t, SENT, SENT + 0.2));
    return { s: 1 - 0.12 * press, vars: { '--ready': ready.toFixed(3) } };
  };
  return (
    <span className="fl-card fl-thread">
      <span className="fl-thread-head">
        <span className="fl-avatar fl-avatar--sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- still from the film's own footage */}
          <img src={JORDAN_IMG} alt="" draggable={false} />
        </span>
        <span className="fl-thread-who">
          <span className="fl-thread-name">Jordan K.</span>
          <span className="fl-thread-sub">
            <Icon name="chat" size={14} />
            Whispers · only you two
          </span>
        </span>
      </span>
      <span className="fl-thread-day">After your Spark · 15 min</span>
      <span className="fl-thread-body">
        <Bubble t0={66.5}>Great talk. I&apos;ll send my notes tonight.</Bubble>
        <Bubble t0={SENT} out>
          {REPLY.text}
        </Bubble>
        <Fx anchor={false} className="fl-typing" fx={typing}>
          <i />
          <i />
          <i />
        </Fx>
        <Bubble t0={ANSWER}>Thursday works. See you there.</Bubble>
      </span>
      <span className="fl-thread-compose">
        <span className="fl-thread-input">
          <Fx as="span" anchor={false} className="fl-thread-placeholder" fx={placeholder}>
            Whisper to Jordan
          </Fx>
          <Fx as="span" anchor={false} fx={composer} />
        </span>
        <Fx as="span" anchor={false} className="fl-thread-send" fx={send}>
          <Icon name="send" size={18} />
        </Fx>
      </span>
    </span>
  );
}

interface RailItem {
  icon: IconName;
  tip: string;
  /** Tooltip window. */
  tipAt: readonly [number, number];
  click: number;
}

const RAIL: readonly RailItem[] = [
  { icon: 'captions', tip: 'Private note', tipAt: [71.15, NOTE_CLICK], click: NOTE_CLICK },
  { icon: 'check', tip: 'Remind me', tipAt: [73.35, REMIND_CLICK], click: REMIND_CLICK },
  { icon: 'send', tip: 'Share', tipAt: [99, 99], click: 99 },
];

function RailButton({ item, i }: { item: RailItem; i: number }) {
  const fx: Animator = (t) => {
    const press = Math.max(0, 1 - Math.abs(t - item.click) / 0.12);
    const on = i === 0 ? seg(t, item.click, item.click + 0.2) * (1 - seg(t, item.click + 0.25, item.click + 0.4)) : seg(t, item.click, item.click + 0.2);
    return { s: 1 - 0.14 * press, vars: { '--on': on.toFixed(3) } };
  };
  const tip: Animator = (t) => {
    const p = pop(t, item.tipAt[0], 0.35);
    return { s: p.s, o: p.o * (1 - seg(t, item.tipAt[1], item.tipAt[1] + 0.15)) };
  };
  return (
    <Fx anchor={false} className="fl-rail-btn" fx={fx}>
      <Icon name={item.icon} size={20} />
      <Fx as="span" anchor={false} className="fl-tip" fx={tip}>
        {item.tip}
      </Fx>
    </Fx>
  );
}

function NoteCard() {
  const fx: Animator = (t, L) => {
    const from = railPos(L, 0);
    const to = NOTE_AT(L);
    const k = seg(t, NOTE_CLICK + 0.1, NOTE_CLICK + 0.8, ease.std);
    const q = seg(t, OUT, OUT + 0.5, ease.exit);
    return {
      x: lerp(from.x, to.x, k),
      y: lerp(from.y, to.y, k),
      s: (0.16 + 0.84 * k) * (1 - 0.06 * q),
      o: seg(t, NOTE_CLICK + 0.05, NOTE_CLICK + 0.2) * (1 - q),
      vars: { '--morph': k.toFixed(3) },
    };
  };
  return (
    <Fx className="fl-card fl-pnote fl-pnote--morph" fx={fx}>
      <span className="fl-pnote-head">
        <Icon name="captions" size={16} />
        Private note
      </span>
      <span className="fl-pnote-text">Jordan: wants to join the solar co-op. Coffee Thursday.</span>
      <Chip t0={72.8} className="fl-chip--saved">
        <Icon name="check" size={14} />
        Saved
      </Chip>
    </Fx>
  );
}

export function ShotWhispers() {
  const plane: Animator = (t, L) => {
    const p = PLANE(L);
    const r = rise(t, 65.8, 99, 50, 0.8);
    const k = seg(t, TILT, TILT + 1.1, ease.std);
    const q = seg(t, OUT, OUT + 0.55, ease.exit);
    return {
      x: p.x - 30 * k,
      y: p.y + (r.y ?? 0),
      ry: -14 * k,
      rx: 4 * k,
      s: (1 - 0.06 * k) * (1 - 0.05 * q),
      o: (r.o ?? 1) * (1 - q),
      blur: (r.blur ?? 0) + q * 6,
    };
  };
  const rail: Animator = (t, L) => {
    const k = seg(t, TILT + 0.2, TILT + 0.8, ease.std);
    return { x: RAIL_DX(L), y: (1 - k) * 30, o: k, blur: (1 - k) * 6 };
  };
  const cursor = (L: Layout): ReadonlyArray<CursorKey> => {
    const a = railPos(L, 0);
    const b = railPos(L, 1);
    const end = pick(L, { x: 640, y: 300 }, { x: 300, y: 560 });
    return [
      [70.6, end.x, end.y],
      [71.05, a.x - 14, a.y - 4],
      [72.9, a.x - 14, a.y - 4],
      [73.35, b.x - 14, b.y - 4],
      [74.2, b.x - 14, b.y - 4],
      [74.9, end.x, end.y],
    ];
  };
  return (
    <Shot range={[63.65, 76.05]} className="fl-persp">
      <div className="fl-dots" />
      <Aurora a={63.65} b={76} className="fl-aurora--soft" />
      <Arcs />
      <Caption text="Keep talking. *Just the two of you.*" t0={63.75} t1={65.95} from={0.7} className="fl-caption2--lg" />
      <Fx className="fl-wplane" fx={plane}>
        <Thread />
        <Fx className="fl-rail" fx={rail}>
          {RAIL.map((item, i) => (
            <RailButton key={item.tip} item={item} i={i} />
          ))}
        </Fx>
      </Fx>
      <NoteCard />
      <Chip
        t0={74.0}
        t1={OUT}
        anchor
        className="fl-chip--glass"
        x={(L) => NOTE_AT(L).x}
        y={(L) => NOTE_AT(L).y + pick(L, 150, 150)}
      >
        <Icon name="check" size={14} />
        Reminder set · Thu 9:00
      </Chip>
      <Cursor path={cursor} clicks={[NOTE_CLICK, REMIND_CLICK]} range={[70.5, 75.2]} />
    </Shot>
  );
}
