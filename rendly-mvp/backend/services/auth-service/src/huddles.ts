/**
 * Huddles (group video calls) and participants.
 * Uses Supabase; tables: huddles, huddle_participants; RPC: join_huddle.
 *
 * Database failures throw HuddleStoreError so callers can answer 500
 * instead of mistaking an outage for "not found" or "empty".
 */

import crypto from "crypto";
import { supabase } from "./supabase-users";
import { isLive, isUuid, type CreateHuddleInput, type HuddleCategory, type HuddleRow } from "./huddle-rules";

export type { HuddleRow, HuddleType } from "./huddle-rules";

const LIVE_LIMIT = 100;
const TRENDY_LIMIT = 20;
const INVITE_CODE_BYTES = 8;

export class HuddleStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[huddles] ${operation} failed`);
    this.name = "HuddleStoreError";
    console.error(`[huddles] ${operation} error:`, cause);
  }
}

export type JoinResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "ended" | "full"; message: string };

const JOIN_FAILURE_MESSAGES: Record<"not_found" | "ended" | "full", string> = {
  not_found: "Huddle not found",
  ended: "Huddle has ended",
  full: "Huddle is full",
};

function requireClient() {
  if (!supabase) throw new HuddleStoreError("connect", "Supabase is not configured");
  return supabase;
}

function generateInviteCode(): string {
  return crypto.randomBytes(INVITE_CODE_BYTES).toString("base64url");
}

/** Live huddles visible to the viewer, filtered and limited in SQL (list_live_huddles). */
async function fetchLiveHuddles(viewerId: string): Promise<HuddleRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("list_live_huddles", { p_viewer_id: viewerId, p_limit: LIVE_LIMIT });
  if (error) throw new HuddleStoreError("list live", error);
  return (data ?? []) as HuddleRow[];
}

/**
 * List huddles the viewer may see: every non-private huddle plus private ones they created.
 * live = active, started and before its end time (queried separately, so the live set is
 * not cut off by the trendy query's row limit); trendy = the most recent huddles that are not live.
 */
export async function listHuddles(
  category: HuddleCategory,
  viewerId: string
): Promise<{ trendy: HuddleRow[]; live: HuddleRow[] }> {
  if (!isUuid(viewerId)) return { trendy: [], live: [] };
  const live = await fetchLiveHuddles(viewerId);
  if (category === "live") return { trendy: [], live };

  const liveIds = new Set(live.map((h) => h.id));
  const client = requireClient();
  const { data, error } = await client
    .from("huddles")
    .select("*")
    .or(`type.neq.private,created_by.eq.${viewerId}`)
    .order("created_at", { ascending: false })
    .limit(TRENDY_LIMIT + liveIds.size);
  if (error) throw new HuddleStoreError("list", error);

  const nowMs = Date.now();
  const trendy = ((data ?? []) as HuddleRow[])
    .filter((h) => !liveIds.has(h.id) && !isLive(h, nowMs))
    .slice(0, TRENDY_LIMIT);

  if (category === "trendy") return { trendy, live: [] };
  return { trendy, live };
}

/** Active (live) huddles visible to the viewer, for the dashboard home. */
export async function listActiveHuddles(viewerId: string): Promise<HuddleRow[]> {
  const { live } = await listHuddles("live", viewerId);
  return live;
}

/** Create a huddle from already-validated input. */
export async function createHuddle(createdBy: string, input: CreateHuddleInput): Promise<HuddleRow> {
  const client = requireClient();
  const row = {
    created_by: createdBy,
    title: input.title,
    description: input.description,
    max_participants: input.max_participants,
    type: input.type,
    is_active: true,
    started_at: null,
    ended_at: null,
    scheduled_at: input.scheduled_at,
    duration_minutes: input.duration_minutes,
    invite_code: generateInviteCode(),
    settings: input.settings,
  };
  const { data, error } = await client.from("huddles").insert(row).select("*").single();
  if (error || !data) throw new HuddleStoreError("create", error ?? "no row returned");
  return data as HuddleRow;
}

/** One huddle by id, or null when it does not exist. */
export async function getHuddleById(id: string): Promise<HuddleRow | null> {
  if (!isUuid(id)) return null;
  const client = requireClient();
  const { data, error } = await client.from("huddles").select("*").eq("id", id).maybeSingle();
  if (error) throw new HuddleStoreError("get", error);
  return (data as HuddleRow | null) ?? null;
}

/** Active participant counts for many huddles in one query. Missing ids count as 0. */
export async function getParticipantCounts(huddleIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(huddleIds.map((id) => [id, 0]));
  const ids = huddleIds.filter(isUuid);
  if (ids.length === 0) return counts;
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_participants")
    .select("huddle_id")
    .in("huddle_id", ids)
    .is("left_at", null);
  if (error) throw new HuddleStoreError("count participants", error);
  for (const row of (data ?? []) as { huddle_id: string }[]) {
    counts.set(row.huddle_id, (counts.get(row.huddle_id) ?? 0) + 1);
  }
  return counts;
}

/** Active participant count for one huddle. */
export async function getHuddleParticipantCount(huddleId: string): Promise<number> {
  const counts = await getParticipantCounts([huddleId]);
  return counts.get(huddleId) ?? 0;
}

/** Whether the user is currently in the huddle. */
export async function isActiveParticipant(huddleId: string, userId: string): Promise<boolean> {
  if (!isUuid(huddleId) || !isUuid(userId)) return false;
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_participants")
    .select("id")
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw new HuddleStoreError("check participant", error);
  return data != null;
}

/**
 * Join a huddle. The capacity check and the insert run inside the join_huddle
 * SQL function under a row lock, so concurrent joins cannot exceed max_participants.
 * Access control (private huddles) is the caller's job.
 */
export async function joinHuddle(huddleId: string, userId: string): Promise<JoinResult> {
  if (!isUuid(huddleId) || !isUuid(userId)) {
    return { ok: false, reason: "not_found", message: JOIN_FAILURE_MESSAGES.not_found };
  }
  const client = requireClient();
  const { data, error } = await client.rpc("join_huddle", { p_huddle_id: huddleId, p_user_id: userId });
  if (error) throw new HuddleStoreError("join", error);
  const status: unknown = data;
  if (status === "ok") return { ok: true };
  if (status === "not_found" || status === "ended" || status === "full") {
    return { ok: false, reason: status, message: JOIN_FAILURE_MESSAGES[status] };
  }
  throw new HuddleStoreError("join", `unexpected join_huddle result: ${String(status)}`);
}

export type LeaveResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_participant"; message: string };

const LEAVE_FAILURE_MESSAGES: Record<"not_found" | "not_participant", string> = {
  not_found: "Huddle not found",
  not_participant: "You are not in this huddle",
};

/** Leave a huddle, freeing the seat (sets left_at). Runs the leave_huddle SQL function. */
export async function leaveHuddle(huddleId: string, userId: string): Promise<LeaveResult> {
  if (!isUuid(huddleId) || !isUuid(userId)) {
    return { ok: false, reason: "not_found", message: LEAVE_FAILURE_MESSAGES.not_found };
  }
  const client = requireClient();
  const { data, error } = await client.rpc("leave_huddle", { p_huddle_id: huddleId, p_user_id: userId });
  if (error) throw new HuddleStoreError("leave", error);
  const status: unknown = data;
  if (status === "ok") return { ok: true };
  if (status === "not_found" || status === "not_participant") {
    return { ok: false, reason: status, message: LEAVE_FAILURE_MESSAGES[status] };
  }
  throw new HuddleStoreError("leave", `unexpected leave_huddle result: ${String(status)}`);
}
