/**
 * Huddle room signalling over the chat socket: joining a room, relaying WebRTC signals between
 * people in the same room, in-room chat, host mute, and breakout (split) rooms.
 *
 * Who may be in a room is checked against huddle_participants on every join and every
 * host action, so a socket cannot claim a seat it does not hold. Room membership itself lives
 * in memory on this process: a restart drops rooms and clients rejoin.
 */

import type { Server, Socket } from "socket.io";
import { supabase } from "./supabase-users";
import { notifyUsers } from "./notify";
import {
  ADMIN_ROOM,
  ROOM_CAP,
  canBeMovedTo,
  canEnterRoom,
  canManageInRoom,
  hasVideoSlot,
  roomOfUser,
} from "./breakout-rules";

export const MAIN_ROOM = "main";
const ROOM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,19}$/;
const CHAT_MAX_LENGTH = 500;

type Seat = { role: "host" | "co_host" | "participant"; can_speak: boolean; can_share_screen: boolean };

/** roomKey -> userId -> socket ids. roomKey is "<huddleId>:<room>". */
const rooms = new Map<string, Map<string, Set<string>>>();

/** huddleId -> userId -> breakout room the host assigned (absent = main room). */
const assignments = new Map<string, Map<string, string>>();

/** huddleId -> userId -> stream id of the screen they are sharing (only for permitted sharers). */
const screens = new Map<string, Map<string, string>>();

/** huddleId -> room -> admin (co-host) the host made leader of that room. */
const leaders = new Map<string, Map<string, string>>();

/** roomKey -> user recording that room. */
const recordings = new Map<string, string>();

function leadersOf(huddleId: string): Record<string, string> {
  return Object.fromEntries(leaders.get(huddleId) ?? []);
}

/** Send an event to everyone in any room of a huddle. */
function emitToHuddle(io: Server, huddleId: string, event: string, payload: unknown): void {
  const prefix = `${huddleId}:`;
  for (const key of rooms.keys()) if (key.startsWith(prefix)) io.to(key).emit(event, payload);
}

/** Whether `actorId` may manage `targetId` where the target is now (host: anywhere). */
function canManageTarget(huddleId: string, actor: Seat, actorId: string, targetId: string): boolean {
  const room = roomOfUser(roomsOf(huddleId), targetId);
  if (room === null) return actor.role === "host";
  return canManageInRoom(actor.role, actorId, room, leaders.get(huddleId));
}

function isManager(seat: Seat | null): boolean {
  return !!seat && (seat.role === "host" || seat.role === "co_host");
}

/** Whether people may move between rooms and leave on their own (huddles.allow_self_exit). */
async function selfExitAllowed(huddleId: string): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase.from("huddles").select("allow_self_exit").eq("id", huddleId).maybeSingle();
  if (error) {
    console.error("[huddle-room] allow_self_exit lookup failed:", error);
    return true;
  }
  return (data as { allow_self_exit?: boolean } | null)?.allow_self_exit !== false;
}

/** Rooms of a huddle with the people in each. */
function roomsOf(huddleId: string): { room: string; user_ids: string[] }[] {
  const prefix = `${huddleId}:`;
  const out: { room: string; user_ids: string[] }[] = [];
  for (const [key, members] of rooms) {
    if (key.startsWith(prefix)) out.push({ room: key.slice(prefix.length), user_ids: Array.from(members.keys()) });
  }
  return out;
}

/** Socket ids for a user in a room. */
function socketsOf(roomKey: string, userId: string): string[] {
  return Array.from(rooms.get(roomKey)?.get(userId) ?? []);
}

function roomKeyFor(huddleId: string, room: string): string {
  return `${huddleId}:${room}`;
}

/** The user's active, admitted seat, or null. */
export async function seatFor(huddleId: string, userId: string): Promise<Seat | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("huddle_participants")
    .select("role, can_speak, can_share_screen")
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .eq("admitted", true)
    .maybeSingle();
  if (error) {
    console.error("[huddle-room] seat lookup failed:", error);
    return null;
  }
  return (data as Seat | null) ?? null;
}

function validRoom(name: unknown): name is string {
  return name === MAIN_ROOM || (typeof name === "string" && ROOM_NAME_PATTERN.test(name));
}

function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function addToRoom(roomKey: string, userId: string, socketId: string): void {
  let members = rooms.get(roomKey);
  if (!members) {
    members = new Map();
    rooms.set(roomKey, members);
  }
  let sockets = members.get(userId);
  if (!sockets) {
    sockets = new Set();
    members.set(userId, sockets);
  }
  sockets.add(socketId);
}

/** Remove one socket from a room. Returns true when the user has no sockets left there. */
function removeFromRoom(roomKey: string, userId: string, socketId: string): boolean {
  const members = rooms.get(roomKey);
  if (!members) return false;
  const sockets = members.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size > 0) return false;
  members.delete(userId);
  if (members.size === 0) rooms.delete(roomKey);
  return true;
}

/** Attach huddle room handlers to a connected, authenticated socket. */
export function attachHuddleRoom(io: Server, socket: Socket, userId: string): void {
  // Rooms this socket has joined, so a disconnect can leave them all.
  const joined = new Set<string>();

  const leave = (roomKey: string) => {
    if (!joined.has(roomKey)) return;
    joined.delete(roomKey);
    socket.leave(roomKey);
    const before = Array.from(rooms.get(roomKey)?.keys() ?? []);
    const wentAway = removeFromRoom(roomKey, userId, socket.id);
    if (wentAway) {
      const cut = roomKey.indexOf(":");
      const huddleId = roomKey.slice(0, cut);
      const room = roomKey.slice(cut + 1);
      screens.get(huddleId)?.delete(userId);
      io.to(roomKey).emit("huddle:peer-left", { user_id: userId });
      if (recordings.get(roomKey) === userId) {
        recordings.delete(roomKey);
        io.to(roomKey).emit("huddle:recording", { room, by: null });
      }
      // A freed main-room video slot goes to the next person in join order.
      const after = Array.from(rooms.get(roomKey)?.keys() ?? []);
      for (const id of after) {
        if (!hasVideoSlot(room, before, id, "participant") && hasVideoSlot(room, after, id, "participant")) {
          for (const sid of socketsOf(roomKey, id)) io.to(sid).emit("huddle:video-slot", { room, has_slot: true });
        }
      }
    }
  };

  socket.on("huddle:join", async (data: { huddle_id?: unknown; room?: unknown }, ack?: (r: unknown) => void) => {
    const huddleId = data?.huddle_id;
    const room = data?.room ?? MAIN_ROOM;
    if (!isUuidLike(huddleId) || !validRoom(room)) {
      ack?.({ ok: false, message: "Invalid room" });
      return;
    }
    const seat = await seatFor(huddleId, userId);
    if (!seat) {
      ack?.({ ok: false, message: "You do not have a seat in this huddle" });
      return;
    }
    // Hosts and co-hosts may enter any room (to peek). Others go to main or the room they were
    // assigned; when the host controls entry and exit, they cannot leave an assigned room.
    if (!isManager(seat)) {
      const assigned = assignments.get(huddleId)?.get(userId) ?? MAIN_ROOM;
      if (room !== assigned) {
        const free = room === MAIN_ROOM && (await selfExitAllowed(huddleId));
        if (!free) {
          ack?.({ ok: false, message: "The host decides who moves between rooms" });
          return;
        }
        assignments.get(huddleId)?.delete(userId);
      }
    }
    const key = roomKeyFor(huddleId, room);
    const occupants = Array.from(rooms.get(key)?.keys() ?? []);
    const entry = canEnterRoom(seat.role, room, occupants, userId);
    if (!entry.ok) {
      ack?.({ ok: false, message: entry.message });
      return;
    }
    const peers = occupants.filter((id) => id !== userId);
    addToRoom(key, userId, socket.id);
    joined.add(key);
    socket.join(key);
    socket.to(key).emit("huddle:peer-joined", { user_id: userId });
    const sharing = Object.fromEntries(
      Array.from(screens.get(huddleId)?.entries() ?? []).filter(([id]) => peers.includes(id))
    );
    ack?.({
      ok: true,
      room,
      peers,
      role: seat.role,
      can_speak: seat.can_speak,
      can_share_screen: seat.can_share_screen || isManager(seat),
      screens: sharing,
      video_slot: hasVideoSlot(room, Array.from(rooms.get(key)?.keys() ?? []), userId, seat.role),
      leaders: leadersOf(huddleId),
      recording: recordings.get(key) ?? null,
    });
  });

  /** Host/co-host: the huddle's rooms and who is in each (for breakouts and peeking). */
  socket.on("huddle:rooms", async (data: { huddle_id?: unknown }, ack?: (r: unknown) => void) => {
    if (typeof ack !== "function" || !isUuidLike(data?.huddle_id)) return;
    const seat = await seatFor(data.huddle_id, userId);
    if (!isManager(seat)) {
      ack({ ok: false, message: "Only the host can see all rooms" });
      return;
    }
    ack({ ok: true, rooms: roomsOf(data.huddle_id), leaders: leadersOf(data.huddle_id), room_cap: ROOM_CAP });
  });

  /**
   * Screen share marker: stream_id while sharing, null when stopped. Only people the host allowed
   * (or hosts/co-hosts) are announced; clients render only announced screen streams.
   */
  socket.on("huddle:screen", async (data: { huddle_id?: unknown; room?: unknown; stream_id?: unknown }, ack?: (r: unknown) => void) => {
    const reply = typeof ack === "function" ? ack : () => undefined;
    if (!isUuidLike(data?.huddle_id) || !validRoom(data?.room)) return;
    const key = roomKeyFor(data.huddle_id, data.room);
    if (!joined.has(key)) return;
    const streamId = typeof data.stream_id === "string" ? data.stream_id.slice(0, 128) : null;
    if (streamId) {
      const seat = await seatFor(data.huddle_id, userId);
      if (!seat || !(seat.can_share_screen || isManager(seat))) {
        reply({ ok: false, message: "Ask the host for permission to share your screen" });
        return;
      }
      let map = screens.get(data.huddle_id);
      if (!map) {
        map = new Map();
        screens.set(data.huddle_id, map);
      }
      map.set(userId, streamId);
    } else {
      screens.get(data.huddle_id)?.delete(userId);
    }
    socket.to(key).emit("huddle:screen", { from: userId, stream_id: streamId });
    reply({ ok: true });
  });

  socket.on("huddle:leave", (data: { huddle_id?: unknown; room?: unknown }) => {
    if (!isUuidLike(data?.huddle_id)) return;
    leave(roomKeyFor(data.huddle_id, typeof data.room === "string" ? data.room : MAIN_ROOM));
  });

  // WebRTC signals are relayed only to people in the same room.
  socket.on("huddle:signal", (data: { huddle_id?: unknown; room?: unknown; to?: unknown; data?: unknown }) => {
    if (!isUuidLike(data?.huddle_id) || !isUuidLike(data?.to) || !validRoom(data?.room)) return;
    const key = roomKeyFor(data.huddle_id, data.room);
    if (!joined.has(key)) return;
    for (const sid of socketsOf(key, data.to)) {
      io.to(sid).emit("huddle:signal", { from: userId, room: data.room, data: data.data });
    }
  });

  socket.on("huddle:chat", (data: { huddle_id?: unknown; room?: unknown; text?: unknown }) => {
    if (!isUuidLike(data?.huddle_id) || !validRoom(data?.room)) return;
    const key = roomKeyFor(data.huddle_id, data.room);
    if (!joined.has(key)) return;
    const text = typeof data.text === "string" ? data.text.trim().slice(0, CHAT_MAX_LENGTH) : "";
    if (!text) return;
    io.to(key).emit("huddle:chat", { from: userId, room: data.room, text, at: new Date().toISOString() });
  });

  /**
   * A token transfer the sender just completed, shown in the room's chat. `from` is always the
   * socket's own user, so a client can only announce its own sends.
   */
  socket.on("huddle:tokens", (data: { huddle_id?: unknown; room?: unknown; to?: unknown; amount?: unknown }) => {
    if (!isUuidLike(data?.huddle_id) || !validRoom(data?.room) || !isUuidLike(data?.to)) return;
    const amount = typeof data.amount === "number" ? Math.floor(data.amount) : 0;
    if (amount < 1 || amount > 1_000_000) return;
    const key = roomKeyFor(data.huddle_id, data.room);
    if (!joined.has(key)) return;
    io.to(key).emit("huddle:tokens", { from: userId, to: data.to, amount, room: data.room, at: new Date().toISOString() });
    // The recipient may be in another room of this huddle: refresh their balance either way.
    io.to(data.to).emit("points:changed");
  });

  /** The host ended the huddle for everyone: tell every connected participant to leave. */
  socket.on("huddle:end", async (data: { huddle_id?: unknown }) => {
    if (!isUuidLike(data?.huddle_id)) return;
    const actor = await seatFor(data.huddle_id, userId);
    if (!actor || actor.role !== "host") return;
    const prefix = `${data.huddle_id}:`;
    for (const [key, members] of rooms) {
      if (!key.startsWith(prefix)) continue;
      for (const uid of members.keys()) {
        for (const sid of socketsOf(key, uid)) io.to(sid).emit("huddle:ended", { huddle_id: data.huddle_id });
      }
    }
    leaders.delete(data.huddle_id);
    assignments.delete(data.huddle_id);
    for (const key of Array.from(recordings.keys())) if (key.startsWith(prefix)) recordings.delete(key);
  });

  // Host and co-host controls. The seat check reads the role from the database.
  socket.on("huddle:mute", async (data: { huddle_id?: unknown; target?: unknown; muted?: unknown }) => {
    if (!isUuidLike(data?.huddle_id) || !isUuidLike(data?.target) || typeof data?.muted !== "boolean") return;
    const actor = await seatFor(data.huddle_id, userId);
    if (!actor || !canManageTarget(data.huddle_id, actor, userId, data.target)) return;
    const target = await seatFor(data.huddle_id, data.target);
    if (!target || target.role === "host") return;
    // The target may be in any room of this huddle, so check each of them.
    const prefix = `${data.huddle_id}:`;
    for (const key of rooms.keys()) {
      if (!key.startsWith(prefix)) continue;
      for (const sid of socketsOf(key, data.target)) {
        io.to(sid).emit("huddle:muted", { muted: data.muted, by: userId });
      }
    }
  });

  /**
   * Breakout rooms: move people between rooms inside one huddle. Each assignment is sent to the
   * person, who leaves their current room and joins the new one. Host and co-host only.
   */
  socket.on(
    "huddle:breakout",
    async (data: { huddle_id?: unknown; assignments?: unknown }) => {
      if (!isUuidLike(data?.huddle_id) || typeof data?.assignments !== "object" || data.assignments === null) return;
      const actor = await seatFor(data.huddle_id, userId);
      if (!actor || (actor.role !== "host" && actor.role !== "co_host")) return;
      const huddleId = data.huddle_id;
      const entries = Object.entries(data.assignments as Record<string, unknown>).slice(0, 200);
      // People already in each room, so a move never pushes a breakout room past its cap.
      const fill = new Map(roomsOf(huddleId).map((r) => [r.room, r.user_ids.length]));
      const movedToBreakout: string[] = [];
      let map = assignments.get(data.huddle_id);
      if (!map) {
        map = new Map();
        assignments.set(data.huddle_id, map);
      }
      for (const [targetId, room] of entries) {
        if (!isUuidLike(targetId) || !validRoom(room)) continue;
        const targetSeat = await seatFor(huddleId, targetId); // only people with a seat here
        if (!targetSeat || !canBeMovedTo(targetSeat.role, room)) continue;
        // An admin moves only people in the room they lead; the host moves anyone.
        if (actor.role !== "host" && !canManageTarget(huddleId, actor, userId, targetId)) continue;
        if (room !== MAIN_ROOM && room !== ADMIN_ROOM && targetSeat.role === "participant") {
          if ((fill.get(room) ?? 0) >= ROOM_CAP) continue;
          fill.set(room, (fill.get(room) ?? 0) + 1);
        }
        if (room === MAIN_ROOM) map.delete(targetId);
        else map.set(targetId, room);
        for (const sid of socketsByUser(io, targetId)) {
          io.to(sid).emit("huddle:assigned", { huddle_id: data.huddle_id, room });
        }
        if (room !== MAIN_ROOM) movedToBreakout.push(targetId);
      }
      // Also leave a notification, so someone who looks away sees where they were sent.
      await Promise.all(
        movedToBreakout.map((targetId) => {
          const room = (data.assignments as Record<string, string>)[targetId];
          return notifyUsers([targetId], {
            type: "breakout",
            title: `You were moved to breakout room "${room}"`,
            body: actor.role === "host" ? "The host split the huddle into rooms." : "Your room leader moved you.",
            payload: { huddle_id: data.huddle_id, room },
          });
        })
      );
    }
  );

  /** Host only: make an admin the leader of a room (user_id null clears it). */
  socket.on("huddle:leader", async (data: { huddle_id?: unknown; room?: unknown; user_id?: unknown }, ack?: (r: unknown) => void) => {
    const reply = typeof ack === "function" ? ack : () => undefined;
    if (!isUuidLike(data?.huddle_id) || !validRoom(data?.room) || data.room === ADMIN_ROOM) {
      reply({ ok: false, message: "Invalid room" });
      return;
    }
    const actor = await seatFor(data.huddle_id, userId);
    if (actor?.role !== "host") {
      reply({ ok: false, message: "Only the host chooses room leaders" });
      return;
    }
    let map = leaders.get(data.huddle_id);
    if (data.user_id === null || data.user_id === undefined) {
      map?.delete(data.room);
    } else {
      if (!isUuidLike(data.user_id)) {
        reply({ ok: false, message: "Invalid person" });
        return;
      }
      const target = await seatFor(data.huddle_id, data.user_id);
      if (target?.role !== "co_host") {
        reply({ ok: false, message: "Make them an admin first" });
        return;
      }
      if (!map) {
        map = new Map();
        leaders.set(data.huddle_id, map);
      }
      // One room per leader: drop any room they led before.
      for (const [r, id] of Array.from(map)) if (id === data.user_id) map.delete(r);
      map.set(data.room, data.user_id);
    }
    emitToHuddle(io, data.huddle_id, "huddle:leaders", { leaders: leadersOf(data.huddle_id) });
    reply({ ok: true, leaders: leadersOf(data.huddle_id) });
  });

  /** Host, or the leader of the person's room: allow or revoke screen sharing. */
  socket.on(
    "huddle:permit",
    async (data: { huddle_id?: unknown; target?: unknown; can_share_screen?: unknown }, ack?: (r: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (!isUuidLike(data?.huddle_id) || !isUuidLike(data?.target) || typeof data?.can_share_screen !== "boolean") {
        reply({ ok: false, message: "Invalid request" });
        return;
      }
      const actor = await seatFor(data.huddle_id, userId);
      if (!actor || !canManageTarget(data.huddle_id, actor, userId, data.target)) {
        reply({ ok: false, message: "Only the host or this room's leader can do that" });
        return;
      }
      const target = await seatFor(data.huddle_id, data.target);
      if (!target || target.role === "host") {
        reply({ ok: false, message: "Cannot change this person" });
        return;
      }
      if (!supabase) {
        reply({ ok: false, message: "Service unavailable" });
        return;
      }
      const { error } = await supabase
        .from("huddle_participants")
        .update({ can_share_screen: data.can_share_screen })
        .eq("huddle_id", data.huddle_id)
        .eq("user_id", data.target)
        .is("left_at", null);
      if (error) {
        console.error("[huddle-room] permit update failed:", error);
        reply({ ok: false, message: "Could not update sharing permission" });
        return;
      }
      for (const sid of socketsByUser(io, data.target)) {
        io.to(sid).emit("huddle:permissions", { huddle_id: data.huddle_id, can_share_screen: data.can_share_screen });
      }
      if (!data.can_share_screen) screens.get(data.huddle_id)?.delete(data.target);
      reply({ ok: true });
    }
  );

  /** Host (any room) or the room's leader: start or stop recording; everyone in the room is told. */
  socket.on("huddle:recording", async (data: { huddle_id?: unknown; room?: unknown; on?: unknown }, ack?: (r: unknown) => void) => {
    const reply = typeof ack === "function" ? ack : () => undefined;
    if (!isUuidLike(data?.huddle_id) || !validRoom(data?.room) || typeof data?.on !== "boolean") {
      reply({ ok: false, message: "Invalid request" });
      return;
    }
    const key = roomKeyFor(data.huddle_id, data.room);
    if (!joined.has(key)) {
      reply({ ok: false, message: "Join the room first" });
      return;
    }
    const actor = await seatFor(data.huddle_id, userId);
    if (!canManageInRoom(actor?.role, userId, data.room, leaders.get(data.huddle_id))) {
      reply({ ok: false, message: "Only the host or this room's leader can record" });
      return;
    }
    const current = recordings.get(key);
    if (data.on) {
      if (current && current !== userId) {
        reply({ ok: false, message: "Someone is already recording this room" });
        return;
      }
      recordings.set(key, userId);
    } else if (current === userId || actor?.role === "host") {
      recordings.delete(key);
    }
    io.to(key).emit("huddle:recording", { room: data.room, by: recordings.get(key) ?? null });
    reply({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const key of Array.from(joined)) leave(key);
  });
}

/** Sockets of a user that are connected at all (used for breakout assignments). */
function socketsByUser(io: Server, userId: string): string[] {
  return Array.from(io.sockets.adapter.rooms.get(userId) ?? []);
}
