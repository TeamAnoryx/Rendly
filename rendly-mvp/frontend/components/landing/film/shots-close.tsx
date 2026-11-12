'use client';

import React from 'react';
import { RendlyLockup } from '@/components/brand/Brand';
import { ELENA, MARCO, type CastMember } from './cast';
import { Fx, Shot, type Animator } from './engine';
import { Face, Icon, SparkMark, Words, enter } from './primitives';
import { ease, lerp, seg } from './timeline';

/* ---------------- 4. Two profiles meet ---------------- */

interface ProfileProps {
  who: CastMember;
  meta: string;
  why: string;
  side: -1 | 1;
}

function Profile({ who, meta, why, side }: ProfileProps) {
  const fx: Animator = (t, L) => {
    const k = seg(t, 17.15 + (side > 0 ? 0.12 : 0), 18.3 + (side > 0 ? 0.12 : 0), ease.std);
    const gap = L.portrait ? 218 : 232;
    const lean = seg(t, 18.4, 19.4, ease.std);
    return { x: side * (gap + (1 - k) * 260 - lean * 8), y: (L.portrait ? -60 : -40) + (1 - k) * 12, o: k };
  };
  return (
    <Fx className="fl-profile" fx={fx}>
      <Face who={who} aspect={4 / 3} loosen={1.15} className="fl-profile-photo" />
      <div className="fl-profile-body">
        <div className="fl-profile-name">{who.name}</div>
        <div className="fl-profile-meta">{meta}</div>
        <span className="fl-chip fl-chip--sm is-picked">
          <Icon name="rocket" size={16} />
          Co-founder
          <span className="fl-chip-fill" style={{ opacity: 1 }} />
        </span>
        <p className="fl-profile-why">{why}</p>
      </div>
    </Fx>
  );
}

export function ShotMeet() {
  const scene: Animator = (t) => {
    const { o } = enter(t, 17, 22.6, 0.4, 0.6);
    return { o, s: 1 + seg(t, 17, 22.6) * 0.025 };
  };
  const badge: Animator = (t, L) => {
    const k = seg(t, 18.5, 19.2, ease.std);
    return { y: L.portrait ? -60 : -40, s: 0.5 + k * 0.5, o: k };
  };
  const cta: Animator = (t, L) => {
    const k = seg(t, 19.1, 19.9, ease.std);
    const press = seg(t, 20.55, 20.68) - seg(t, 20.68, 21.1, ease.std);
    return { y: (L.portrait ? 400 : 345) + (1 - k) * 14, o: k, s: 1 - press * 0.05 };
  };
  const ripple: Animator = (t) => {
    const k = seg(t, 20.6, 21.4, ease.std);
    return { s: 0.2 + k * 1.6, o: k > 0 ? (1 - k) * 0.35 : 0 };
  };
  return (
    <Shot range={[17, 22.6]} fx={scene}>
      <Profile who={MARCO} meta="Energy engineer · Rotterdam" why="Turn grid models into tools people use." side={-1} />
      <Profile who={ELENA} meta="Product designer · Lisbon" why="Ship climate software people rely on." side={1} />
      <Fx className="fl-badge" fx={badge}>
        <SparkMark size={26} />
      </Fx>
      <Fx className="fl-cta fl-cta--tonal" fx={cta}>
        <Fx as="span" anchor={false} className="fl-ripple" fx={ripple} />
        <Icon name="video" size={22} />
        Start video call
      </Fx>
    </Shot>
  );
}

/* ---------------- 5. Live video call ---------------- */

interface Line {
  who: 'e' | 'm';
  text: string;
  a: number;
  b: number;
}

const LINES: readonly Line[] = [
  { who: 'e', text: 'So what got you into climate?', a: 23.1, b: 24.9 },
  { who: 'm', text: 'Grid modelling. I want it in people’s hands.', a: 25.2, b: 27.1 },
  { who: 'e', text: 'Same here. Let’s build it together.', a: 27.4, b: 28.9 },
];

const speaking = (t: number, who: 'e' | 'm') => LINES.some((l) => l.who === who && t >= l.a - 0.1 && t <= l.b + 0.2);

function Bars({ who }: { who: 'e' | 'm' }) {
  return (
    <span className="fl-bars">
      {[0, 1, 2].map((i) => (
        <Fx
          key={i}
          as="span"
          anchor={false}
          fx={(t) => {
            const on = speaking(t, who) ? 1 : 0;
            const h = on ? 0.35 + 0.65 * Math.abs(Math.sin(t * (7 + i * 3) + i)) : 0.2;
            return { sy: h };
          }}
        />
      ))}
    </span>
  );
}

export function ShotCall() {
  const scene: Animator = (t) => {
    const { o, k } = enter(t, 22, 29.6, 0.8, 0.6);
    return { o, s: 0.94 + k * 0.06 + seg(t, 22, 29.6) * 0.03 };
  };
  const stage: Animator = (_t, L) => ({ y: L.portrait ? -70 : -50 });
  const pipRing: Animator = (t) => ({ o: speaking(t, 'm') ? 1 : 0 });
  const mainRing: Animator = (t) => ({ o: speaking(t, 'e') ? 1 : 0 });
  const timer: Animator = (t) => {
    const s = Math.max(0, Math.floor(t - 22.3)) + 12;
    return { text: `00:${String(s).padStart(2, '0')}` };
  };
  const bar: Animator = (t, L) => {
    const k = seg(t, 22.5, 23.3, ease.std);
    return { y: (L.portrait ? 470 : 392) + (1 - k) * 14, o: k };
  };
  return (
    <Shot range={[22, 29.6]} fx={scene}>
      <Fx className="fl-call" fx={stage}>
        <Face who={ELENA} aspect={1.62} loosen={1.45} className="fl-call-main fl-call-main--land" />
        <Face who={ELENA} aspect={0.82} loosen={1.7} className="fl-call-main fl-call-main--port" />
        <span className="fl-call-shade" />
        <Fx as="span" anchor={false} className="fl-call-ring" fx={mainRing} />
        <span className="fl-live">
          <i />
          Live
          <Fx as="span" anchor={false} className="fl-live-time" fx={timer} />
        </span>
        <span className="fl-name">
          <Bars who="e" />
          {ELENA.name}
        </span>
        <span className="fl-pip">
          <Face who={MARCO} aspect={1.5} loosen={1.6} />
          <Fx as="span" anchor={false} className="fl-pip-ring" fx={pipRing} />
          <span className="fl-pip-name">
            <Bars who="m" />
            You
          </span>
        </span>
        <span className="fl-captions">
          {LINES.map((l) => (
            <Fx
              key={l.text}
              as="span"
              anchor={false}
              className="fl-cap"
              fx={(t) => {
                const k = seg(t, l.a, l.a + 0.4, ease.std);
                const q = seg(t, l.b + 0.15, l.b + 0.45);
                return { o: k * (1 - q), y: (1 - k) * 8 };
              }}
            >
              <b>{l.who === 'e' ? 'Elena' : 'Marco'}</b>
              <Fx
                as="span"
                anchor={false}
                fx={(t) => ({ text: l.text.slice(0, Math.round(seg(t, l.a, l.b - 0.3) * l.text.length)) })}
              />
            </Fx>
          ))}
        </span>
      </Fx>
      <Fx className="fl-callbar" fx={bar}>
        <span className="fl-round">
          <Icon name="mic" />
        </span>
        <span className="fl-round">
          <Icon name="video" />
        </span>
        <span className="fl-round is-on">
          <Icon name="captions" />
        </span>
        <span className="fl-round">
          <Icon name="chat" />
        </span>
        <span className="fl-round">
          <Icon name="more" />
        </span>
        <span className="fl-endcall">
          <Icon name="end" />
        </span>
      </Fx>
    </Shot>
  );
}

/* ---------------- 6. Whispers ---------------- */

interface Msg {
  out: boolean;
  text: string;
  at: number;
}

const MSGS: readonly Msg[] = [
  { out: false, text: 'Loved that call. Same time Thursday?', at: 29.9 },
  { out: true, text: 'Yes. I’ll bring the grid data.', at: 31.3 },
  { out: false, text: 'Perfect. Let’s sketch the first version.', at: 32.7 },
];

export function ShotWhispers() {
  const scene: Animator = (t) => {
    const { o, k } = enter(t, 29, 34.6, 0.8, 0.6);
    return { o, s: 0.97 + k * 0.03 };
  };
  const title: Animator = (_t, L) => (L.portrait ? { y: -420 } : { x: -400, y: 0 });
  const panel: Animator = (t, L) => {
    const k = seg(t, 29.2, 30.1, ease.std);
    const base = L.portrait ? { x: 0, y: 90 } : { x: 300, y: 0 };
    return { x: base.x + (1 - k) * (L.portrait ? 0 : 40), y: base.y + (1 - k) * (L.portrait ? 30 : 0), o: k };
  };
  const typing: Animator = (t) => {
    const k = seg(t, 32.0, 32.2) * (1 - seg(t, 32.6, 32.75));
    return { o: k };
  };
  return (
    <Shot range={[29, 34.6]} fx={scene}>
      <Fx className="fl-side" fx={title}>
        <span className="fl-kicker">
          <Icon name="chat" size={18} />
          Whispers
        </span>
        <span className="fl-side-title">
          <Words text="Keep the thread going." t0={29.25} size={64} accent={3} />
        </span>
      </Fx>
      <Fx className="fl-chat" fx={panel}>
        <div className="fl-chat-head">
          <span className="fl-chat-avatar">
            <Face who={ELENA} loosen={1.2} />
            <i />
          </span>
          <span className="fl-chat-who">
            <b>{ELENA.name}</b>
            <span>Active now</span>
          </span>
          <span className="fl-chat-more">
            <Icon name="video" size={20} />
            <Icon name="more" size={20} />
          </span>
        </div>
        <div className="fl-chat-body">
          <span className="fl-chat-day">Today</span>
          {MSGS.map((m, i) => {
            const bubble = (
              <Fx
                key={m.text}
                anchor={false}
                className={`fl-msg${m.out ? ' is-out' : ''}`}
                fx={(t) => {
                  const k = seg(t, m.at, m.at + 0.6, ease.std);
                  return { o: k, y: (1 - k) * 14, s: 0.96 + k * 0.04 };
                }}
              >
                {m.text}
              </Fx>
            );
            if (i < MSGS.length - 1) return bubble;
            return (
              <div key={m.text} className="fl-slot">
                <Fx anchor={false} className="fl-typing" fx={typing}>
                  <i />
                  <i />
                  <i />
                </Fx>
                {bubble}
              </div>
            );
          })}
        </div>
        <div className="fl-composer">
          <Icon name="plus" size={20} />
          <span>Message</span>
          <Icon name="smile" size={20} />
          <span className="fl-composer-send">
            <Icon name="send" size={18} />
          </span>
        </div>
      </Fx>
    </Shot>
  );
}

/* ---------------- 7. End card ---------------- */

export function ShotEnd() {
  const scene: Animator = (t) => {
    const k = seg(t, 33.9, 34.8, ease.std);
    return { o: k, s: lerp(1.02, 1, seg(t, 34, 40, ease.std)) };
  };
  const logo: Animator = (t, L) => {
    const k = seg(t, 34.4, 35.5, ease.std);
    return { y: (L.portrait ? -230 : -190) + (1 - k) * 14, o: k };
  };
  const sub: Animator = (t, L) => {
    const k = seg(t, 36.2, 37.1, ease.std);
    return { y: (L.portrait ? 120 : 92) + (1 - k) * 12, o: k };
  };
  const cta: Animator = (t, L) => {
    const k = seg(t, 36.6, 37.5, ease.std);
    return { y: (L.portrait ? 250 : 200) + (1 - k) * 12, o: k, live: k > 0.5 };
  };
  return (
    <Shot range={[33.9, 40]} fx={scene}>
      <Fx className="fl-end-logo" fx={logo}>
        <RendlyLockup className="fl-lockup" />
      </Fx>
      <Fx className="fl-hero fl-hero--end" fx={(_t, L) => ({ y: L.portrait ? -40 : -40 })}>
        <Words text="Find your who." t0={35.1} size={140} accent={2} stagger={0.1} />
      </Fx>
      <Fx className="fl-sub fl-sub--end" fx={sub}>
        Rendly matches people on why they are here.
      </Fx>
      <Fx as="a" href="/auth/sign-up" className="fl-cta fl-cta--filled" fx={cta} tabIndex={-1}>
        Get started
        <Icon name="arrow" size={22} />
      </Fx>
    </Shot>
  );
}
