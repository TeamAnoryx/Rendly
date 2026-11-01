/**
 * Spark match room: a temporary chat between two matched users.
 *
 * Messages are relayed socket to socket and never stored, so the chat is gone the moment
 * either side skips or closes. A socket can only talk to a partner it was actually matched
 * with in the last few hours (checked against match_queue).
 */

import type { Socket } from "socket.io";
import { supabase } from "./supabase-users";

const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SparkLeaveReason = "skip" | "close" | "left";

/** Trim and bound a chat message; null when there is nothing to send. */
export function normaliseSparkText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Drop control characters except newline and tab.
  const text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (!text) return null;
  return text.slice(0, MAX_TEXT);
}

/** True when userId was matched with partnerId recently. */
async function wasMatched(userId: string, partnerId: string): Promise<boolean> {
  if (!supabase) return false;
  const since = new Date(Date.now() - MATCH_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("match_queue")
    .select("id")
    .eq("user_id", userId)
    .eq("partner_user_id", partnerId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .limit(1);
  if (error) {
    console.error("[spark-room] match check failed:", error);
    return false;
  }
  return (data ?? []).length > 0;
}

type Ack = (res: { ok: boolean; message?: string }) => void;

export function attachSparkRoom(socket: Socket, userId: string): void {
  let partnerId: string | null = null;
  let sent: number[] = [];

  const end = (reason: SparkLeaveReason) => {
    if (!partnerId) return;
    socket.to(partnerId).emit("spark:ended", { from: userId, reason });
    partnerId = null;
  };

  socket.on("spark:join", async (data: { partner_id?: unknown }, ack?: Ack) => {
    const reply = typeof ack === "function" ? ack : () => undefined;
    const candidate = typeof data?.partner_id === "string" ? data.partner_id : "";
    if (!UUID.test(candidate) || candidate === userId) {
      reply({ ok: false, message: "Invalid partner" });
      return;
    }
    try {
      if (!(await wasMatched(userId, candidate))) {
        reply({ ok: false, message: "You were not matched with this person" });
        return;
      }
      if (partnerId && partnerId !== candidate) end("skip");
      partnerId = candidate;
      socket.to(candidate).emit("spark:partner-joined", { from: userId });
      reply({ ok: true });
    } catch (err) {
      console.error("[spark-room] join failed:", err);
      reply({ ok: false, message: "Could not open the match room" });
    }
  });

  socket.on("spark:chat", (data: { text?: unknown; client_id?: unknown }, ack?: Ack) => {
    const reply = typeof ack === "function" ? ack : () => undefined;
    if (!partnerId) {
      reply({ ok: false, message: "Not in a match" });
      return;
    }
    const text = normaliseSparkText(data?.text);
    if (!text) {
      reply({ ok: false, message: "Empty message" });
      return;
    }
    const now = Date.now();
    sent = sent.filter((t) => now - t < RATE_WINDOW_MS);
    if (sent.length >= RATE_MAX) {
      reply({ ok: false, message: "Slow down a little" });
      return;
    }
    sent.push(now);
    const clientId = typeof data?.client_id === "string" ? data.client_id.slice(0, 64) : null;
    socket.to(partnerId).emit("spark:chat", { from: userId, text, client_id: clientId, at: new Date(now).toISOString() });
    reply({ ok: true });
  });

  socket.on("spark:typing", (data: { typing?: unknown }) => {
    if (partnerId) socket.to(partnerId).emit("spark:typing", { from: userId, typing: data?.typing === true });
  });

  socket.on("spark:camera", (data: { on?: unknown }) => {
    if (partnerId) socket.to(partnerId).emit("spark:camera", { from: userId, on: data?.on === true });
  });

  socket.on("spark:leave", (data: { reason?: unknown }) => {
    end(data?.reason === "skip" ? "skip" : "close");
  });

  socket.on("disconnect", () => end("left"));
}
