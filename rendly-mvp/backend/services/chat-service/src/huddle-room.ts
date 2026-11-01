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
    const wentAway = removeFromRoom(roomKey, userId, socket.id);
    if (wentAway) {
      screens.get(roomKey.split(":")[0])?.delete(userId);
      io.to(roomKey).emit("huddle:peer-left", { user_id: userId });
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
    const peers = Array.from(rooms.get(key)?.keys() ?? []).filter((id) => id !== userId);
    addToRoom(key, userId, socket.id);
    joined.add(key);
    socket.join(key);
    socket.to(key).emit("huddle:peer-joined", { user_id: userId });
    const sharing = Object.fromEntries(
      Array.from(screens.get(huddleId)?.entries() ?? []).filter(([id]) => peers.includes(id))
    );
    ack?.({ ok: true, room, peers, role: seat.role, can_speak: seat.can_speak, can_share_screen: seat.can_share_screen || isManager(seat), screens: sharing });
  });

  /** Host/co-host: the huddle's rooms and who is in each (for breakouts and peeking). */
  socket.on("huddle:rooms", async (data: { huddle_id?: unknown }, ack?: (r: unknown) => void) => {
    if (typeof ack !== "function" || !isUuidLike(data?.huddle_id)) return;
    const seat = await seatFor(data.huddle_id, userId);
    if (!isManager(seat)) {
      ack({ ok: false, message: "Only the host can see all rooms" });
      return;
    }
    ack({ ok: true, rooms: roomsOf(data.huddle_id) });
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

  // Host and co-host controls. The seat check reads the role from the database.
  socket.on("huddle:mute", async (data: { huddle_id?: unknown; target?: unknown; muted?: unknown }) => {
    if (!isUuidLike(data?.huddle_id) || !isUuidLike(data?.target) || typeof data?.muted !== "boolean") return;
    const actor = await seatFor(data.huddle_id, userId);
    if (!actor || (actor.role !== "host" && actor.role !== "co_host")) return;
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
      const entries = Object.entries(data.assignments as Record<string, unknown>).slice(0, 200);
      const movedToBreakout: string[] = [];
      let map = assignments.get(data.huddle_id);
      if (!map) {
        map = new Map();
        assignments.set(data.huddle_id, map);
      }
      for (const [targetId, room] of entries) {
        if (!isUuidLike(targetId) || !validRoom(room)) continue;
        if (!(await seatFor(data.huddle_id, targetId))) continue; // only people with a seat here
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
            body: "The host split the huddle into rooms.",
            payload: { huddle_id: data.huddle_id, room },
          });
        })
      );
    }
  );

  socket.on("disconnect", () => {
    for (const key of Array.from(joined)) leave(key);
  });
}

/** Sockets of a user that are connected at all (used for breakout assignments). */
function socketsByUser(io: Server, userId: string): string[] {
  return Array.from(io.sockets.adapter.rooms.get(userId) ?? []);
}
