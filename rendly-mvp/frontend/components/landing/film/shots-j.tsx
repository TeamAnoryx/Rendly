'use client';

/**
 * Chapter 11 (76-93 s): Huddles, in depth. A room list with live rooms and a
 * toast from Jordan; she joins, the list row zooms into the room, people drop
 * in, a speaking ring moves between them, Leo raises a hand, topic cards
 * swap, reactions float up, she copies the invite link, and the room folds
 * into the plan they made: a meetup card that leads into real life.
 */

import React from 'react';
import { Clip, type ClipName } from './clips';
import { Fx, Shot, type Animator, type Layout } from './engine';
import { Aurora, Caption } from './kit2';
import { Chip, Cursor, pick, pop, type CursorKey } from './kit';
import { Icon, type IconName } from './primitives';
import { clamp, ease, lerp, seg } from './timeline';

const A = 76;
const B = 93.4;
const JOIN = 78.7;
const ROOM = 79.2;
const INVITE = 87.0;
const FOLD = 88.9;

/* ---------------- Room list ---------------- */

interface RoomRow {
  name: string;
  icon: IconName;
  count: string;
  live: boolean;
}

const ROWS: readonly RoomRow[] = [
  { name: 'Climate & coffee', icon: 'leaf', count: '4 of 6', live: true },
  { name: 'Spanish practice', icon: 'globe', count: '3 of 6', live: true },
  { name: 'Weekend run club', icon: 'run', count: '5 of 6', live: false },
  { name: 'Design critique', icon: 'smile', count: '2 of 6', live: true },
];

const LIST = (L: Layout) => pick(L, { x: 0, y: 40 }, { x: 0, y: 60 });
const ROW_Y = (i: number) => -51 + i * 84;
const JOIN_AT = (L: Layout) => ({ x: LIST(L).x + 290, y: LIST(L).y + ROW_Y(0) });

function RoomList() {
  const fx: Animator = (t, L) => {
    const p = LIST(L);
    const k = seg(t, 76.15, 76.75, ease.std);
    const zoom = seg(t, JOIN + 0.1, ROOM + 0.4, ease.inCubic);
    return {
      x: p.x,
      y: p.y + (1 - k) * 60 - zoom * ROW_Y(0) * 2,
      s: (0.94 + 0.06 * k) * (1 + 1.6 * zoom) * pick(L, 1, 0.95),
      o: k * (1 - seg(t, ROOM, ROOM + 0.4)),
      blur: (1 - k) * 8 + zoom * 8,
    };
  };
  return (
    <Fx className="fl-card fl-rooms" fx={fx}>
      <span className="fl-rooms-head">
        <Icon name="users" size={20} />
        Huddles near your why
        <span className="fl-rooms-meta">Up to 6 per room</span>
      </span>
      {ROWS.map((r, i) => {
        const row: Animator = (t) => {
          const k = seg(t, 76.5 + i * 0.1, 76.95 + i * 0.1, ease.std);
          const hl = i === 0 ? seg(t, 77.9, 78.2) : 0;
          return { o: k, y: (1 - k) * 16, vars: { '--hl': hl.toFixed(3) } };
        };
        const join: Animator = (t) => {
          const press = i === 0 ? Math.max(0, 1 - Math.abs(t - JOIN) / 0.12) : 0;
          return { s: 1 - 0.1 * press };
        };
        return (
          <Fx key={r.name} anchor={false} className="fl-room" fx={row}>
            <span className="fl-room-icon">
              <Icon name={r.icon} size={20} />
            </span>
            <span className="fl-room-name">{r.name}</span>
            {r.live && (
              <span className="fl-room-live">
                <span className="fl-live" />
                Live
              </span>
            )}
            <span className="fl-room-count">{r.count}</span>
            <Fx as="span" anchor={false} className="fl-room-join" fx={join}>
              Join
            </Fx>
          </Fx>
        );
      })}
    </Fx>
  );
}

function Toast({ t0, t1, icon, children, y }: { t0: number; t1: number; icon: IconName; children: React.ReactNode; y?: (L: Layout) => number }) {
  const fx: Animator = (t, L) => {
    const k = seg(t, t0, t0 + 0.45, ease.spring);
    const q = seg(t, t1, t1 + 0.35, ease.exit);
    return { y: (y ? y(L) : pick(L, -360, -540)) - (1 - k) * 60 - q * 40, s: 0.9 + 0.1 * k, o: clamp(k * 1.5) * (1 - q) };
  };
  return (
    <Fx className="fl-toast" fx={fx}>
      <span className="fl-toast-icon">
        <Icon name={icon} size={18} />
      </span>
      {children}
    </Fx>
  );
}

/* ---------------- The room ---------------- */

interface Member {
  name: string;
  clip: ClipName | null;
  /** Drop-in time. */
  t0: number;
  speaks: ReadonlyArray<readonly [number, number]>;
}

const MEMBERS: readonly Member[] = [
  { name: 'Jordan K.', clip: 'call', t0: 79.5, speaks: [[81.5, 83.0]] },
  { name: 'Min J.', clip: 'min', t0: 79.75, speaks: [[84.4, 85.8]] },
  { name: 'Ravi S.', clip: 'ravi', t0: 80.0, speaks: [[83.0, 84.4]] },
  { name: 'Leo R.', clip: 'remote', t0: 80.25, speaks: [] },
  { name: 'You', clip: 'laptop-pip', t0: 80.6, speaks: [[85.8, 87.2]] },
  { name: 'Open seat', clip: null, t0: 80.85, speaks: [] },
];

const HAND_AT = 83.6;

/** Room grid: 3x2 in landscape, 2x3 in portrait. */
const CELL = (L: Layout, i: number) => {
  if (L.portrait) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return { x: (col - 0.5) * 296, y: (row - 1) * 296 + 40 };
  }
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: (col - 1) * 452, y: (row - 0.5) * 262 + 10 };
};

function speakingAt(t: number, m: Member): number {
  return m.speaks.reduce((v, [a, b]) => Math.max(v, seg(t, a, a + 0.25) * (1 - seg(t, b - 0.2, b))), 0);
}

function Tile({ m, i }: { m: Member; i: number }) {
  const fx: Animator = (t, L) => {
    const c = CELL(L, i);
    const k = seg(t, m.t0, m.t0 + 0.6, ease.spring);
    const fold = seg(t, FOLD + i * 0.05, FOLD + 0.6 + i * 0.05, ease.inCubic);
    const target = CARD_AT(L);
    return {
      x: lerp(c.x, target.x, fold),
      y: lerp(c.y - (1 - k) * 220, target.y, fold),
      s: (0.85 + 0.15 * k) * (1 - 0.85 * fold),
      o: clamp(k * 2) * (1 - seg(t, FOLD + 0.4 + i * 0.05, FOLD + 0.6 + i * 0.05)),
      vars: { '--speak': speakingAt(t, m).toFixed(3) },
    };
  };
  const hand: Animator = (t) => {
    const p = pop(t, HAND_AT, 0.5);
    const wave = Math.sin(clamp((t - HAND_AT) / 0.8) * Math.PI * 3) * 12 * (1 - seg(t, HAND_AT + 0.8, HAND_AT + 1));
    return { s: p.s, o: p.o * (1 - seg(t, 85.2, 85.5)), rz: wave };
  };
  return (
    <Fx className={`fl-htile fl-rtile${m.clip ? '' : ' fl-htile--open'}`} fx={fx}>
      {m.clip ? (
        <Clip name={m.clip} range={[ROOM, FOLD + 1]} loop className="fl-grade fl-grade--call" focus="50% 30%" />
      ) : (
        <span className="fl-htile-invite">
          <Icon name="plus" size={22} />
          Open seat
        </span>
      )}
      {m.clip && <span className="fl-htile-name">{m.name}</span>}
      {m.name === 'Leo R.' && (
        <Fx as="span" anchor={false} className="fl-hand" fx={hand}>
          <Icon name="hand" size={20} />
        </Fx>
      )}
    </Fx>
  );
}

interface Topic {
  t0: number;
  t1: number;
  text: string;
}

const TOPICS: readonly Topic[] = [
  { t0: 81.3, t1: 84.9, text: 'Topic · Starting a repair café' },
  { t0: 84.9, t1: 88.7, text: 'Topic · Solar co-op meetup this Saturday?' },
];

function TopicCard({ tp }: { tp: Topic }) {
  const fx: Animator = (t, L) => {
    const k = seg(t, tp.t0, tp.t0 + 0.45, ease.std);
    const q = seg(t, tp.t1 - 0.3, tp.t1, ease.exit);
    return { y: pick(L, -370, -560), s: (1.15 - 0.15 * k) * (1 - 0.3 * q), o: k * (1 - q), blur: (1 - k) * 6 + q * 4 };
  };
  return (
    <Fx className="fl-topic" fx={fx}>
      <Icon name="chat" size={18} />
      {tp.text}
    </Fx>
  );
}

const REACTIONS: ReadonlyArray<readonly [number, IconName, number]> = [
  [83.3, 'heart', 0],
  [83.55, 'spark', 40],
  [83.8, 'smile', -30],
  [85.2, 'heart', 20],
  [85.45, 'heart', -40],
  [85.7, 'spark', 10],
  [86.2, 'smile', 30],
];

function Reaction({ t0, icon, dx }: { t0: number; icon: IconName; dx: number }) {
  const fx: Animator = (t, L) => {
    const k = seg(t, t0, t0 + 1.6, ease.outCubic);
    const base = pick(L, { x: 600, y: 330 }, { x: 340, y: 560 });
    return {
      x: base.x + dx + Math.sin(k * 6 + dx) * 18,
      y: base.y - k * 320,
      s: pop(t, t0, 0.35).s * (1 - 0.3 * k),
      o: seg(t, t0, t0 + 0.1) * (1 - seg(t, t0 + 1.1, t0 + 1.6)),
    };
  };
  return (
    <Fx className="fl-react" fx={fx}>
      <Icon name={icon} size={22} />
    </Fx>
  );
}

const DOCK = (L: Layout) => pick(L, { x: 0, y: 372 }, { x: 0, y: 545 });
const INVITE_AT = (L: Layout) => ({ x: DOCK(L).x + 118, y: DOCK(L).y });

function RoomDock() {
  const fx: Animator = (t, L) => {
    const k = seg(t, 80.9, 81.4, ease.std);
    const q = seg(t, FOLD - 0.1, FOLD + 0.3, ease.exit);
    return { y: DOCK(L).y + (1 - k) * 40, o: k * (1 - q) };
  };
  const hand: Animator = (t) => ({ vars: { '--on': seg(t, 85.0, 85.15).toFixed(3) } });
  const invite: Animator = (t) => {
    const press = Math.max(0, 1 - Math.abs(t - INVITE) / 0.12);
    return { s: 1 - 0.1 * press, vars: { '--on': (seg(t, INVITE, INVITE + 0.15) * (1 - seg(t, 88.2, 88.4))).toFixed(3) } };
  };
  return (
    <Fx className="fl-dock fl-rdock" fx={fx}>
      <span className="fl-dock-btn">
        <Icon name="mic" size={20} />
      </span>
      <span className="fl-dock-btn">
        <Icon name="video" size={20} />
      </span>
      <Fx as="span" anchor={false} className="fl-dock-btn fl-dock-btn--tog" fx={hand}>
        <Icon name="hand" size={20} />
      </Fx>
      <span className="fl-dock-btn">
        <Icon name="heart" size={20} />
      </span>
      <Fx as="span" anchor={false} className="fl-dock-btn fl-dock-btn--tog" fx={invite}>
        <Icon name="link" size={20} />
      </Fx>
      <span className="fl-dock-btn is-end">
        <Icon name="end" size={20} />
      </span>
    </Fx>
  );
}

function RoomHead() {
  const fx: Animator = (t, L) => {
    const p = pop(t, 80.2, 0.5);
    return { y: pick(L, -300, -470), s: p.s, o: p.o * (1 - seg(t, FOLD - 0.2, FOLD + 0.2)) };
  };
  const count: Animator = (t) => {
    const n = MEMBERS.filter((m) => m.clip && t >= m.t0 + 0.2).length;
    return { text: `${Math.max(1, n)} of 6` };
  };
  return (
    <Fx className="fl-huddlehead" fx={fx}>
      <span className="fl-live" />
      Climate &amp; coffee
      <span className="fl-huddlehead-sep" />
      <Fx as="span" anchor={false} fx={count} />
    </Fx>
  );
}

/* ---------------- Fold into the plan ---------------- */

const CARD_AT = (L: Layout) => pick(L, { x: 0, y: 30 }, { x: 0, y: 20 });

function PlanCard() {
  const fx: Animator = (t, L) => {
    const p = CARD_AT(L);
    const k = seg(t, FOLD + 0.45, FOLD + 1.0, ease.spring);
    const zoom = seg(t, 92.2, B, ease.inCubic);
    return { x: p.x, y: p.y, s: (0.6 + 0.4 * k) * (1 + 1.2 * zoom) * pick(L, 1, 0.95), o: clamp(k * 1.6) * (1 - seg(t, 92.6, B)), blur: zoom * 10 };
  };
  const going: Animator = (t) => ({ text: `${Math.round(lerp(1, 5, seg(t, FOLD + 1.1, FOLD + 2.0)))} going` });
  return (
    <Fx className="fl-card fl-plan" fx={fx}>
      <span className="fl-plan-date">
        <span className="fl-plan-day">SAT</span>
        <span className="fl-plan-num">10:00</span>
      </span>
      <span className="fl-plan-body">
        <span className="fl-plan-title">Solar co-op meetup</span>
        <span className="fl-plan-sub">
          <Icon name="pin" size={14} />
          From the Climate &amp; coffee huddle
        </span>
      </span>
      <Fx as="span" anchor={false} className="fl-plan-going" fx={going} />
    </Fx>
  );
}

function joinPath(L: Layout): ReadonlyArray<CursorKey> {
  const j = JOIN_AT(L);
  const start = pick(L, { x: 620, y: 380 }, { x: 360, y: 560 });
  return [
    [77.6, start.x, start.y],
    [78.4, j.x, j.y],
    [79.3, j.x, j.y],
  ];
}

function invitePath(L: Layout): ReadonlyArray<CursorKey> {
  const inv = INVITE_AT(L);
  return [
    [86.1, inv.x + 200, inv.y + 140],
    [86.8, inv.x, inv.y],
    [87.6, inv.x, inv.y],
    [88.3, inv.x + 140, inv.y + 100],
  ];
}

export function ShotHuddles() {
  return (
    <Shot range={[A, B]}>
      <div className="fl-dots" />
      <Aurora a={A} b={B} className="fl-aurora--soft" />
      <Caption text="*Huddles.* Small live rooms, up to six." t0={76.05} t1={78.9} from={0.75} y={(L) => pick(L, -320, -480)} className="fl-caption2--md" />
      <RoomList />
      <Toast t0={77.0} t1={78.6} icon="bell" y={(L) => pick(L, -230, -380)}>
        <span>
          <b>Jordan</b> is live in Climate &amp; coffee
        </span>
      </Toast>
      <RoomHead />
      {TOPICS.map((tp) => (
        <TopicCard key={tp.t0} tp={tp} />
      ))}
      {MEMBERS.map((m, i) => (
        <Tile key={m.name} m={m} i={i} />
      ))}
      <RoomDock />
      {REACTIONS.map(([t0, icon, dx]) => (
        <Reaction key={t0} t0={t0} icon={icon} dx={dx} />
      ))}
      <Toast t0={INVITE + 0.15} t1={88.5} icon="link" y={(L) => pick(L, 302, 440)}>
        Invite link copied
      </Toast>
      <Chip t0={89.75} t1={92.3} anchor className="fl-chip--glass" y={(L) => pick(L, 150, 210)}>
        <Icon name="users" size={14} />
        People who share one why
      </Chip>
      <PlanCard />
      <Cursor path={joinPath} clicks={[JOIN]} range={[77.6, 79.2]} />
      <Cursor path={invitePath} clicks={[INVITE]} range={[86.1, 88.4]} />
    </Shot>
  );
}
