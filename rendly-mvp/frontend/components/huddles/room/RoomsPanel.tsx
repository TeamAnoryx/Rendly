'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import websocket from '@/services/websocket';
import type { HuddleMember } from '@/services/huddlesApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import {
  ADMIN_ROOM,
  MAIN_ROOM,
  MAX_BREAKOUT_ROOMS,
  ROOM_CAP,
  ROOM_NAME,
  autoSplit,
  breakoutRoomNames,
  ledRoom,
  planCounts,
  roomLabel,
  suggestedRoomCount,
  type RoomRole,
} from './roomRules';

type LiveRoom = { room: string; user_ids: string[] };
type RoomsAck = { ok: boolean; rooms?: LiveRoom[]; leaders?: Record<string, string>; message?: string };
const ROOMS_POLL_MS = 4000;

export type RoomsPanelProps = {
  huddleId: string;
  members: HuddleMember[];
  myId: string | null;
  role: RoomRole;
  currentRoom: string;
  leaders: Record<string, string>;
  onPeek: (room: string) => void;
};

/**
 * Breakout rooms. The host splits people into rooms (up to 12 each), picks an admin to lead
 * each room and can peek anywhere. A room leader sees their room and can move its people.
 */
export default function RoomsPanel({ huddleId, members, myId, role, currentRoom, leaders, onPeek }: RoomsPanelProps) {
  const isHost = role === 'host';
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [count, setCount] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const people = useMemo(
    () => members.filter((m) => m.admitted && m.user_id !== myId && m.role === 'participant'),
    [members, myId],
  );
  const admins = useMemo(() => members.filter((m) => m.admitted && m.role === 'co_host'), [members]);
  const roomNames = useMemo(() => breakoutRoomNames(count), [count]);
  const counts = useMemo(() => planCounts(plan), [plan]);
  const myRoom = ledRoom(leaders, myId);

  useEffect(() => {
    // Start with enough rooms for everyone under the cap.
    setCount((c) => Math.max(c, suggestedRoomCount(people.length)));
  }, [people.length]);

  const refresh = useCallback(async () => {
    try {
      const res = await websocket.emitWithAck<RoomsAck>('huddle:rooms', { huddle_id: huddleId });
      if (res?.ok) setRooms(res.rooms ?? []);
      else setErr(res?.message ?? 'Could not load rooms');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load rooms');
    }
  }, [huddleId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), ROOMS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const label = (id: string) => {
    const m = members.find((x) => x.user_id === id);
    return m?.display_name || (m?.username ? `@${m.username}` : 'Guest');
  };

  const move = (assignments: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(assignments).filter(([, r]) => r === MAIN_ROOM || ROOM_NAME.test(r)));
    if (!websocket.isConnected()) {
      setErr('Not connected — nobody was moved. Try again once you are back online.');
      return;
    }
    setErr(null);
    websocket.emit('huddle:breakout', { huddle_id: huddleId, assignments: clean });
    setSent(Object.keys(clean).length ? 'People are being moved.' : null);
    setTimeout(() => void refresh(), 800);
  };

  const setLeader = async (room: string, userId: string | null) => {
    try {
      const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('huddle:leader', { huddle_id: huddleId, room, user_id: userId });
      if (!res?.ok) setErr(res?.message ?? 'Could not set the leader');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set the leader');
    }
  };

  const liveBreakouts = rooms.filter((r) => r.room !== MAIN_ROOM && r.room !== ADMIN_ROOM).map((r) => r.room);
  const leaderRooms = Array.from(new Set([...roomNames, ...liveBreakouts])).sort();
  const sorted = [...rooms].sort((a, b) => (a.room === MAIN_ROOM ? -1 : b.room === MAIN_ROOM ? 1 : a.room.localeCompare(b.room)));
  const visibleRooms = isHost ? sorted : sorted.filter((r) => r.room === myRoom || r.room === ADMIN_ROOM || r.room === MAIN_ROOM);
  const myRoomPeople = rooms.find((r) => r.room === myRoom)?.user_ids.filter((id) => id !== myId) ?? [];
  const destinations = [MAIN_ROOM, ...liveBreakouts.filter((r) => r !== myRoom)];

  return (
    <div className="hr-rooms rd-scroll">
      {err ? <p className="hr-err">{err}</p> : null}

      <h4 className="hr-subhead">Live rooms</h4>
      {visibleRooms.length === 0 ? <p className="rd-small rd-muted">Only the main room is open.</p> : null}
      {visibleRooms.map((r) => {
        const breakout = r.room !== MAIN_ROOM && r.room !== ADMIN_ROOM;
        const lead = leaders[r.room];
        return (
          <div key={r.room} className={`hr-room ${r.room === currentRoom ? 'hr-room--here' : ''}`}>
            <div className="hr-room-head">
              <strong>{roomLabel(r.room)}</strong>
              <span className={`rd-small ${breakout && r.user_ids.length >= ROOM_CAP ? 'hr-room-full' : 'rd-muted'}`}>
                {breakout ? `${r.user_ids.length}/${ROOM_CAP}` : `${r.user_ids.length} in room`}
              </span>
              {r.room !== currentRoom ? (
                <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => onPeek(r.room)}>
                  <Icon name="eye" size={14} /> {r.room === MAIN_ROOM ? 'Return' : r.room === ADMIN_ROOM ? 'Join' : 'Peek'}
                </button>
              ) : (
                <span className="rd-chip">You are here</span>
              )}
            </div>
            {breakout && lead ? (
              <p className="hr-room-lead">
                <Icon name="shield" size={12} /> Leader: {lead === myId ? 'You' : label(lead)}
              </p>
            ) : null}
            <p className="rd-small rd-muted">{r.user_ids.map(label).join(', ') || 'Empty'}</p>
          </div>
        );
      })}

      {!isHost ? (
        <>
          <h4 className="hr-subhead">Your room</h4>
          {!myRoom ? (
            <p className="rd-small rd-muted">The host has not made you a room leader yet.</p>
          ) : myRoomPeople.length === 0 ? (
            <p className="rd-small rd-muted">Nobody is in {roomLabel(myRoom)} yet.</p>
          ) : (
            myRoomPeople.map((id) => {
              const m = members.find((x) => x.user_id === id);
              return (
                <div key={id} className="hr-person">
                  <Avatar url={m?.avatar_url} name={m?.username} size="sm" />
                  <span className="hr-person-name">{label(id)}</span>
                  <select
                    className="rd-select"
                    value=""
                    onChange={(e) => e.target.value && move({ [id]: e.target.value })}
                    aria-label={`Move ${label(id)} to another room`}
                  >
                    <option value="">Move to…</option>
                    {destinations.map((r) => (
                      <option key={r} value={r}>
                        {roomLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })
          )}
          {sent ? <p className="rd-small rd-muted">{sent}</p> : null}
        </>
      ) : (
        <>
          <h4 className="hr-subhead">Room leaders</h4>
          {admins.length === 0 ? (
            <p className="rd-small rd-muted">Make someone an admin in People first. Admins can lead a room.</p>
          ) : (
            leaderRooms.map((r) => (
              <div key={r} className="hr-person">
                <Icon name="shield" size={14} />
                <span className="hr-person-name">{roomLabel(r)}</span>
                <select
                  className="rd-select"
                  value={leaders[r] ?? ''}
                  onChange={(e) => void setLeader(r, e.target.value || null)}
                  aria-label={`Leader of ${roomLabel(r)}`}
                >
                  <option value="">No leader</option>
                  {admins.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {label(a.user_id)}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}

          <h4 className="hr-subhead">Split into rooms</h4>
          {people.length === 0 ? (
            <p className="rd-small rd-muted">Participants appear here once they join.</p>
          ) : (
            <>
              <div className="hr-rooms-row">
                <label className="rd-small">
                  Rooms
                  <select className="rd-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    {Array.from({ length: MAX_BREAKOUT_ROOMS - 1 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => setPlan(autoSplit(people.map((p) => p.user_id), roomNames))}>
                  Auto-assign
                </button>
                <span className="rd-small rd-muted">Up to {ROOM_CAP} per room</span>
              </div>
              {people.map((p) => {
                const current = plan[p.user_id] ?? MAIN_ROOM;
                return (
                  <div key={p.user_id} className="hr-person">
                    <Avatar url={p.avatar_url} name={p.username} size="sm" />
                    <span className="hr-person-name">{label(p.user_id)}</span>
                    <select
                      className="rd-select"
                      value={current}
                      onChange={(e) => setPlan((cur) => ({ ...cur, [p.user_id]: e.target.value }))}
                      aria-label={`Room for ${label(p.user_id)}`}
                    >
                      <option value={MAIN_ROOM}>Main</option>
                      {roomNames.map((r) => {
                        const full = (counts[r] ?? 0) >= ROOM_CAP && current !== r;
                        return (
                          <option key={r} value={r} disabled={full}>
                            {r} ({counts[r] ?? 0}/{ROOM_CAP})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
              <div className="hr-rooms-row">
                <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => move(plan)} disabled={Object.keys(plan).length === 0}>
                  Open rooms
                </button>
                <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => move(Object.fromEntries(people.map((p) => [p.user_id, MAIN_ROOM])))}>
                  Bring everyone back
                </button>
              </div>
              {sent ? <p className="rd-small rd-muted">{sent}</p> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
