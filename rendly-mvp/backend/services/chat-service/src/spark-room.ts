/**
 * Spark match room: a temporary chat and WebRTC signalling channel between two matched users.
 *
 * The client never names its partner. On spark:join the server finds the caller's latest match
 * (last 3 hours) in match_queue and the partner's matching row, and remembers the pair on the
 * socket. Every relay goes only to the partner's sockets that joined the same pairing, and no
 * payload carries a user id or username, so an anonymous match stays anonymous.
 *
 * Messages are never stored: the chat is gone the moment either side skips or closes.
 * Single process: the registry below is in memory (chat-service runs one instance).
 */

import type { Socket } from "socket.io";
import { supabase } from "./supabase-users";

const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const RATE_WINDOW_MS = 10_000;
const CHAT_RATE_MAX = 20;
const TYPING_RATE_MAX = 30;
// TURN + STUN produce many ICE candidates per call (and a renegotiation repeats them).
const SIGNAL_RATE_MAX = 240;
// The client announces its media state on join, consent and every camera/mic switch.
const MEDIA_RATE_MAX = 40;
const SIGNAL_MAX_BYTES = 64 * 1024;
const SDP_MAX = 60_000;
const ICE_CANDIDATE_MAX = 1000;
/** spark:join attempts per user across all their sockets. */
const JOIN_WINDOW_MS = 30_000;
const JOIN_RATE_MAX = 5;
/** Sockets one user may hold in Spark rooms at once. */
const MAX_SOCKETS_PER_USER = 5;

export type SparkLeaveReason = "skip" | "close" | "left";
export type SignalKind = "offer" | "answer" | "ice";
export type SparkSignal =
  | { kind: "offer" | "answer"; data: { type: "offer" | "answer"; sdp: string } }
  | {
      kind: "ice";
      data: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment: string | null } | null;
    };

/** Trim and bound a chat message; null when there is nothing to send. */
export function normaliseSparkText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Drop control characters except newline and tab.
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (!text) return null;
  return text.slice(0, MAX_TEXT);
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) return undefined;
  return value;
}

/**
 * Validate a spark:signal payload and rebuild it with only the known fields.
 * Returns null when the kind, shape or size is wrong.
 */
export function normaliseSparkSignal(raw: unknown): SparkSignal | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw), "utf8");
  } catch {
    return null;
  }
  if (size > SIGNAL_MAX_BYTES) return null;
  const { kind, data } = raw as { kind?: unknown; data?: unknown };
  if (kind === "offer" || kind === "answer") {
    if (typeof data !== "object" || data === null) return null;
    const sdp = (data as { sdp?: unknown }).sdp;
    const type = (data as { type?: unknown }).type;
    if (typeof sdp !== "string" || sdp.length === 0 || sdp.length > SDP_MAX) return null;
    if (type !== undefined && type !== kind) return null;
    return { kind, data: { type: kind, sdp } };
  }
  if (kind === "ice") {
    // null / missing candidate = end of candidates.
    if (data === null || data === undefined) return { kind, data: null };
    if (typeof data !== "object" || Array.isArray(data)) return null;
    const d = data as Record<string, unknown>;
    const candidate = optionalString(d.candidate, ICE_CANDIDATE_MAX);
    const sdpMid = optionalString(d.sdpMid, 64);
    const usernameFragment = optionalString(d.usernameFragment, 256);
    if (candidate === undefined || sdpMid === undefined || usernameFragment === undefined) return null;
    let sdpMLineIndex: number | null = null;
    if (d.sdpMLineIndex !== undefined && d.sdpMLineIndex !== null) {
      if (typeof d.sdpMLineIndex !== "number" || !Number.isInteger(d.sdpMLineIndex) || d.sdpMLineIndex < 0 || d.sdpMLineIndex > 64) {
        return null;
      }
      sdpMLineIndex = d.sdpMLineIndex;
    }
    return { kind, data: { candidate: candidate ?? "", sdpMid, sdpMLineIndex, usernameFragment } };
  }
  return null;
}

export type SparkMedia = { video: boolean; audio: boolean; p2p: boolean };

/**
 * Validate a spark:media payload: video and audio must be booleans; p2p (the sender's
 * connection is direct rather than relayed) is optional and defaults to false.
 */
export function normaliseSparkMedia(raw: unknown): SparkMedia | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { video, audio, p2p } = raw as { video?: unknown; audio?: unknown; p2p?: unknown };
  if (typeof video !== "boolean" || typeof audio !== "boolean") return null;
  if (p2p !== undefined && typeof p2p !== "boolean") return null;
  return { video, audio, p2p: p2p === true };
}

/** One socket's place in a match: who the partner is and which two queue rows pair them. */
type Pairing = { partnerId: string; ownRowId: string; partnerRowId: string };
type Entry = { socket: Socket; pairing: Pairing };

/** userId -> socket id -> entry, for sockets currently in a Spark room. */
const roomSockets = new Map<string, Map<string, Entry>>();

function register(userId: string, socket: Socket, pairing: Pairing): void {
  let byId = roomSockets.get(userId);
  if (!byId) {
    byId = new Map();
    roomSockets.set(userId, byId);
  }
  byId.set(socket.id, { socket, pairing });
}

function unregister(userId: string, socketId: string): void {
  const byId = roomSockets.get(userId);
  if (!byId) return;
  byId.delete(socketId);
  if (byId.size === 0) roomSockets.delete(userId);
}

function socketCount(userId: string): number {
  return roomSockets.get(userId)?.size ?? 0;
}

/** True when this user still has another socket in the same pairing. */
function hasOtherSocketInPairing(userId: string, socketId: string, pairing: Pairing): boolean {
  const byId = roomSockets.get(userId);
  if (!byId) return false;
  for (const [id, entry] of byId) {
    if (id !== socketId && entry.pairing.ownRowId === pairing.ownRowId && entry.pairing.partnerRowId === pairing.partnerRowId) return true;
  }
  return false;
}

/** userId -> recent spark:join timestamps (all sockets). */
const joinHits = new Map<string, number[]>();

/** Per-user sliding window for spark:join; false when the limit is reached. */
function allowJoin(userId: string): boolean {
  const now = Date.now();
  const hits = (joinHits.get(userId) ?? []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (hits.length >= JOIN_RATE_MAX) {
    joinHits.set(userId, hits);
    return false;
  }
  joinHits.set(userId, [...hits, now]);
  return true;
}

// Drop stale join counters so the map does not grow with every user ever seen.
setInterval(() => {
  const now = Date.now();
  for (const [id, hits] of joinHits) {
    if (hits.every((t) => now - t >= JOIN_WINDOW_MS)) joinHits.delete(id);
  }
}, 60_000).unref();

/** Mark both rows of a pairing ended so neither side can rejoin it. Logged, never thrown. */
async function markPairingEnded(pairing: Pairing): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("match_queue")
      .update({ ended_at: new Date().toISOString() })
      .in("id", [pairing.ownRowId, pairing.partnerRowId])
      .is("ended_at", null);
    if (error) console.error("[spark-room] end pairing failed:", error.code ?? error.message);
  } catch (err) {
    console.error("[spark-room] end pairing failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** True when either user blocks the other; also true when the check itself fails. */
async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("id")
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
    .limit(1);
  if (error) {
    console.error("[spark-room] block lookup failed:", error.code ?? error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/** The partner's sockets that joined this exact pairing. */
function partnerSockets(userId: string, pairing: Pairing): Socket[] {
  const byId = roomSockets.get(pairing.partnerId);
  if (!byId) return [];
  const out: Socket[] = [];
  for (const entry of byId.values()) {
    if (entry.pairing.partnerId === userId && entry.pairing.ownRowId === pairing.partnerRowId && entry.pairing.partnerRowId === pairing.ownRowId) {
      out.push(entry.socket);
    }
  }
  return out;
}

/**
 * The caller's latest match in the window and the partner's row of the same pairing, or null.
 * The partner row must also be matched and point back at the caller. A pairing that was
 * ended (ended_at set by a leave, skip or disconnect) or where either side blocks the other
 * is refused.
 */
async function resolvePairing(userId: string): Promise<Pairing | null> {
  if (!supabase) return null;
  const since = new Date(Date.now() - MATCH_WINDOW_MS).toISOString();
  const { data: own, error } = await supabase
    .from("match_queue")
    .select("id, partner_user_id, matched_at, ended_at")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[spark-room] own match lookup failed:", error.code ?? error.message);
    return null;
  }
  const partnerId = (own?.partner_user_id as string | null | undefined) ?? null;
  if (!own || !partnerId || partnerId === userId || own.ended_at) return null;
  const { data: theirs, error: partnerError } = await supabase
    .from("match_queue")
    .select("id, ended_at")
    .eq("user_id", partnerId)
    .eq("status", "matched")
    .eq("partner_user_id", userId)
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (partnerError) {
    console.error("[spark-room] partner match lookup failed:", partnerError.code ?? partnerError.message);
    return null;
  }
  if (!theirs || theirs.ended_at) return null;
  if (await isBlockedEitherWay(userId, partnerId)) return null;
  return { partnerId, ownRowId: own.id as string, partnerRowId: theirs.id as string };
}

/** Sliding-window counter; returns false when the limit for this window is reached. */
function makeLimiter(max: number): () => boolean {
  let hits: number[] = [];
  return () => {
    const now = Date.now();
    hits = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

type Ack = (res: { ok: boolean; message?: string; partner_present?: boolean }) => void;

function ackOf(ack: unknown): Ack {
  return typeof ack === "function" ? (ack as Ack) : () => undefined;
}

export function attachSparkRoom(socket: Socket, userId: string): void {
  let pairing: Pairing | null = null;
  let joining = false;
  const chatLimit = makeLimiter(CHAT_RATE_MAX);
  const typingLimit = makeLimiter(TYPING_RATE_MAX);
  const signalLimit = makeLimiter(SIGNAL_RATE_MAX);
  const mediaLimit = makeLimiter(MEDIA_RATE_MAX);

  const relay = (event: string, payload: Record<string, unknown>): boolean => {
    if (!pairing) return false;
    for (const s of partnerSockets(userId, pairing)) s.emit(event, payload);
    return true;
  };

  /**
   * Leave the current pairing. A skip or close ends it for both sides; a disconnect ends it
   * only when this user has no other socket left in the same pairing.
   */
  const end = (reason: SparkLeaveReason) => {
    if (!pairing) return;
    const ended = pairing;
    const lastSocket = !hasOtherSocketInPairing(userId, socket.id, ended);
    unregister(userId, socket.id);
    pairing = null;
    if (reason !== "left" || lastSocket) {
      for (const s of partnerSockets(userId, ended)) s.emit("spark:ended", { reason });
      void markPairingEnded(ended);
    }
  };

  // Any client-provided partner id is ignored: the server resolves the pair itself.
  socket.on("spark:join", async (_data: unknown, ack?: unknown) => {
    const reply = ackOf(ack);
    if (joining) {
      reply({ ok: false, message: "Already joining" });
      return;
    }
    if (!allowJoin(userId)) {
      reply({ ok: false, message: "Slow down a little" });
      return;
    }
    if (!pairing && socketCount(userId) >= MAX_SOCKETS_PER_USER) {
      reply({ ok: false, message: "Too many open match windows" });
      return;
    }
    joining = true;
    try {
      const found = await resolvePairing(userId);
      if (!found) {
        reply({ ok: false, message: "You have no active match" });
        return;
      }
      if (pairing && (pairing.ownRowId !== found.ownRowId || pairing.partnerRowId !== found.partnerRowId)) end("skip");
      pairing = found;
      register(userId, socket, found);
      const present = partnerSockets(userId, found).length > 0;
      relay("spark:partner-joined", {});
      reply({ ok: true, partner_present: present });
    } catch (err) {
      console.error("[spark-room] join failed:", err instanceof Error ? err.message : "unknown");
      reply({ ok: false, message: "Could not open the match room" });
    } finally {
      joining = false;
    }
  });

  socket.on("spark:chat", (data: unknown, ack?: unknown) => {
    const reply = ackOf(ack);
    if (!pairing) {
      reply({ ok: false, message: "Not in a match" });
      return;
    }
    const input = typeof data === "object" && data !== null ? (data as { text?: unknown; client_id?: unknown }) : {};
    const text = normaliseSparkText(input.text);
    if (!text) {
      reply({ ok: false, message: "Empty message" });
      return;
    }
    if (!chatLimit()) {
      reply({ ok: false, message: "Slow down a little" });
      return;
    }
    const clientId = typeof input.client_id === "string" ? input.client_id.slice(0, 64) : null;
    relay("spark:chat", { text, client_id: clientId, at: new Date().toISOString() });
    reply({ ok: true });
  });

  socket.on("spark:typing", (data: unknown) => {
    if (!pairing || !typingLimit()) return;
    const typing = typeof data === "object" && data !== null && (data as { typing?: unknown }).typing === true;
    relay("spark:typing", { typing });
  });

  socket.on("spark:signal", (data: unknown, ack?: unknown) => {
    const reply = ackOf(ack);
    if (!pairing) {
      reply({ ok: false, message: "Not in a match" });
      return;
    }
    const signal = normaliseSparkSignal(data);
    if (!signal) {
      reply({ ok: false, message: "Invalid signal" });
      return;
    }
    if (!signalLimit()) {
      reply({ ok: false, message: "Slow down a little" });
      return;
    }
    relay("spark:signal", { kind: signal.kind, data: signal.data });
    reply({ ok: true });
  });

  socket.on("spark:media", (data: unknown, ack?: unknown) => {
    const reply = ackOf(ack);
    if (!pairing) {
      reply({ ok: false, message: "Not in a match" });
      return;
    }
    const media = normaliseSparkMedia(data);
    if (!media) {
      reply({ ok: false, message: "Invalid media state" });
      return;
    }
    if (!mediaLimit()) {
      reply({ ok: false, message: "Slow down a little" });
      return;
    }
    relay("spark:media", media);
    reply({ ok: true });
  });

  socket.on("spark:leave", (data: unknown) => {
    const reason = typeof data === "object" && data !== null && (data as { reason?: unknown }).reason === "skip" ? "skip" : "close";
    end(reason);
  });

  socket.on("disconnect", () => end("left"));
}
