/**
 * Huddles (group video calls) and participants.
 * Uses Supabase; tables: huddles, huddle_participants.
 */

import crypto from "crypto";
import { supabase } from "./supabase-users";

export type HuddleType = "public" | "private" | "instant";

export type HuddleRow = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  invite_code: string | null;
  settings: Record<string, unknown>;
  created_at: string;
};

export type HuddleParticipantRow = {
  id: string;
  huddle_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  duration_seconds: number | null;
};

function generateInviteCode(): string {
  return crypto.randomBytes(8).toString("base64url");
}

/** List huddles: live = active and started, trendy = recent or by participant count. */
export async function listHuddles(category: "trendy" | "live" | "all"): Promise<{ trendy: HuddleRow[]; live: HuddleRow[] }> {
  if (!supabase) return { trendy: [], live: [] };
  const { data: all, error } = await supabase
    .from("huddles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[huddles] list error:", error);
    return { trendy: [], live: [] };
  }
  const rows = (all ?? []) as HuddleRow[];
  const now = new Date().toISOString();
  const live = rows.filter(
    (h) => h.is_active && h.started_at != null && (h.ended_at == null || h.ended_at > now)
  );
  const trendy = rows.filter((h) => !live.includes(h)).slice(0, 20);
  if (category === "live") return { trendy: [], live };
  if (category === "trendy") return { trendy, live: [] };
  return { trendy, live };
}

/** List active huddles (for dashboard home). Same as live. */
export async function listActiveHuddles(): Promise<HuddleRow[]> {
  const { live } = await listHuddles("live");
  return live;
}

/** Create a huddle. Returns created row with invite_code. */
export async function createHuddle(
  createdBy: string,
  payload: {
    title: string;
    description?: string | null;
    max_participants: number;
    type?: HuddleType;
    scheduled_at?: string | null;
    duration_minutes?: number | null;
    settings?: Record<string, unknown>;
  }
): Promise<HuddleRow | null> {
  if (!supabase || !createdBy) return null;
  const max = payload.max_participants;
  if (![10, 15, 20, 50].includes(max)) return null;
  const inviteCode = generateInviteCode();
  const row = {
    created_by: createdBy,
    title: payload.title.trim().slice(0, 255) || "Untitled Huddle",
    description: payload.description?.trim() || null,
    max_participants: max,
    type: payload.type ?? "public",
    is_active: true,
    started_at: null,
    ended_at: null,
    scheduled_at: payload.scheduled_at || null,
    duration_minutes: payload.duration_minutes ?? null,
    invite_code: inviteCode,
    settings: payload.settings ?? {},
  };
  const { data, error } = await supabase.from("huddles").insert(row).select("*").single();
  if (error) {
    console.error("[huddles] create error:", error);
    return null;
  }
  return data as HuddleRow;
}

/** Get one huddle by id. */
export async function getHuddleById(id: string): Promise<HuddleRow | null> {
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from("huddles").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return data as HuddleRow | null;
}

/** Get participant count for a huddle. */
export async function getHuddleParticipantCount(huddleId: string): Promise<number> {
  if (!supabase || !huddleId) return 0;
  const { count, error } = await supabase
    .from("huddle_participants")
    .select("*", { count: "exact", head: true })
    .eq("huddle_id", huddleId)
    .is("left_at", null);
  if (error) return 0;
  return count ?? 0;
}

/** Join a huddle. Returns true if joined (or already in). */
export async function joinHuddle(huddleId: string, userId: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase || !huddleId || !userId) return { ok: false, message: "Missing id or user" };
  const huddle = await getHuddleById(huddleId);
  if (!huddle) return { ok: false, message: "Huddle not found" };
  if (huddle.ended_at) return { ok: false, message: "Huddle has ended" };
  const current = await getHuddleParticipantCount(huddleId);
  if (current >= huddle.max_participants) return { ok: false, message: "Huddle is full" };
  const { error } = await supabase.from("huddle_participants").upsert(
    { huddle_id: huddleId, user_id: userId, joined_at: new Date().toISOString(), left_at: null },
    { onConflict: "huddle_id,user_id", ignoreDuplicates: false }
  );
  if (error) {
    console.error("[huddles] join error:", error);
    return { ok: false, message: "Failed to join" };
  }
  return { ok: true };
}
