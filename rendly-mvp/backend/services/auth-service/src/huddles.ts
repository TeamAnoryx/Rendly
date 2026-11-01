/**
 * Huddles (group video calls) and participants.
 * Uses Supabase; tables: huddles, huddle_participants; RPC: join_huddle.
 *
 * Database failures throw HuddleStoreError so callers can answer 500
 * instead of mistaking an outage for "not found" or "empty".
 */

import crypto from "crypto";
import { supabase } from "./supabase-users";
import {
  isLive,
  isUuid,
  rankTrending,
  TRENDING_LIST_SIZE,
  TRENDING_RECENCY_WINDOW_MS,
  TRENDING_VELOCITY_WINDOW_MS,
  type CreateHuddleInput,
  type HuddleActivity,
  type HuddleCategory,
  type HuddleMode,
  type HuddleRow,
} from "./huddle-rules";

export type { HuddleRow, HuddleType } from "./huddle-rules";

const LIVE_LIMIT = 100;
const TRENDY_LIMIT = TRENDING_LIST_SIZE;
/** Recent visible huddles scored for the trending list. */
const TRENDY_CANDIDATE_LIMIT = 100;
const INVITE_CODE_BYTES = 8;

export class HuddleStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[huddles] ${operation} failed`);
    this.name = "HuddleStoreError";
    console.error(`[huddles] ${operation} error:`, cause);
  }
}

export type JoinResult =
  | { ok: true; waiting: boolean }
  | { ok: false; reason: "not_found" | "ended" | "not_started" | "full"; message: string };

const JOIN_FAILURE_MESSAGES: Record<"not_found" | "ended" | "not_started" | "full", string> = {
  not_found: "Huddle not found",
  ended: "Huddle has ended",
  not_started: "Huddle has not started yet",
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
 * not cut off by the trendy query's row limit).
 * trendy = the highest trending scores among recent huddles that are not live, scored with
 * the formula in huddle-rules.ts from visit and join events.
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
  const invitedIds = await fetchInvitedHuddleIds(viewerId);
  const visibility = [`type.neq.private`, `created_by.eq.${viewerId}`];
  if (invitedIds.length > 0) visibility.push(`id.in.(${invitedIds.join(",")})`);
  const { data, error } = await client
    .from("huddles")
    .select("*")
    .or(visibility.join(","))
    .order("created_at", { ascending: false })
    .limit(TRENDY_CANDIDATE_LIMIT);
  if (error) throw new HuddleStoreError("list", error);

  const nowMs = Date.now();
  const candidates = ((data ?? []) as HuddleRow[]).filter((h) => !liveIds.has(h.id) && !isLive(h, nowMs));
  const activity = await fetchHuddleActivity(
    candidates.map((h) => h.id),
    nowMs
  );
  const byId = new Map(candidates.map((h) => [h.id, h]));
  const trendy = rankTrending(
    candidates.map((h) => ({ id: h.id, createdMs: Date.parse(h.created_at) })),
    activity,
    nowMs
  )
    .slice(0, TRENDY_LIMIT)
    .map((r) => byId.get(r.id) as HuddleRow);

  if (category === "trendy") return { trendy, live: [] };
  return { trendy, live };
}

/**
 * Visit, join and leave events for the given huddles over the last day, reduced to the
 * per-huddle figures the trending formula needs. Velocities count the last hour only.
 */
async function fetchHuddleActivity(huddleIds: string[], nowMs: number): Promise<Map<string, HuddleActivity>> {
  const activity = new Map<string, HuddleActivity>();
  if (huddleIds.length === 0) return activity;
  const client = requireClient();
  const since = new Date(nowMs - TRENDING_RECENCY_WINDOW_MS).toISOString();
  const { data, error } = await client
    .from("huddle_events")
    .select("huddle_id, kind, created_at")
    .in("huddle_id", huddleIds)
    .gte("created_at", since);
  if (error) throw new HuddleStoreError("activity", error);

  const velocityCutoff = nowMs - TRENDING_VELOCITY_WINDOW_MS;
  const hourlyByHuddle = new Map<string, number>();
  for (const row of (data ?? []) as { huddle_id: string; kind: string; created_at: string }[]) {
    const at = Date.parse(row.created_at);
    const entry = activity.get(row.huddle_id) ?? { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: 0, createdMs: 0 };
    entry.lastActivityMs = Math.max(entry.lastActivityMs, at);
    if (at >= velocityCutoff) {
      if (row.kind === "visit") entry.visits += 1;
      if (row.kind === "join") entry.seatJoins += 1;
      if (row.kind !== "leave") hourlyByHuddle.set(row.huddle_id, (hourlyByHuddle.get(row.huddle_id) ?? 0) + 1);
    }
    activity.set(row.huddle_id, entry);
  }

  // Tag velocity: the busiest tag a huddle carries, measured over all candidate huddles with that tag.
  const tagsByHuddle = await fetchIntentTags(huddleIds);
  const tagTotals = new Map<string, number>();
  for (const [huddleId, tags] of tagsByHuddle) {
    for (const tag of tags) {
      tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + (hourlyByHuddle.get(huddleId) ?? 0));
    }
  }
  for (const [huddleId, tags] of tagsByHuddle) {
    const entry = activity.get(huddleId) ?? { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: 0, createdMs: 0 };
    entry.tagVelocity = Math.max(0, ...tags.map((t) => tagTotals.get(t) ?? 0));
    activity.set(huddleId, entry);
  }
  return activity;
}

/** Intent tags for each huddle in the list, keyed by huddle id. */
export async function fetchIntentTags(huddleIds: string[]): Promise<Map<string, string[]>> {
  const tags = new Map<string, string[]>();
  if (huddleIds.length === 0) return tags;
  const client = requireClient();
  const { data, error } = await client.from("huddle_intents").select("huddle_id, tag").in("huddle_id", huddleIds);
  if (error) throw new HuddleStoreError("intent tags", error);
  for (const row of (data ?? []) as { huddle_id: string; tag: string }[]) {
    tags.set(row.huddle_id, [...(tags.get(row.huddle_id) ?? []), row.tag]);
  }
  return tags;
}

/** Huddle ids the user has been invited to (private huddles they may open). */
export async function fetchInvitedHuddleIds(userId: string): Promise<string[]> {
  if (!isUuid(userId)) return [];
  const client = requireClient();
  const { data, error } = await client.from("huddle_invites").select("huddle_id").eq("invitee_id", userId);
  if (error) throw new HuddleStoreError("invites", error);
  return ((data ?? []) as { huddle_id: string }[]).map((r) => r.huddle_id).filter(isUuid);
}

/** Whether the user holds an invite to this huddle. */
export async function isInvitedTo(huddleId: string, userId: string): Promise<boolean> {
  if (!isUuid(huddleId) || !isUuid(userId)) return false;
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_invites")
    .select("huddle_id")
    .eq("huddle_id", huddleId)
    .eq("invitee_id", userId)
    .maybeSingle();
  if (error) throw new HuddleStoreError("check invite", error);
  return data != null;
}

/**
 * Record a visit, join or leave for trending. Best effort: a failed write is logged and does
 * not fail the request that triggered it, because the user action itself already succeeded.
 */
export async function recordHuddleEvent(
  huddleId: string,
  userId: string | null,
  kind: "visit" | "join" | "leave"
): Promise<void> {
  if (!isUuid(huddleId)) return;
  try {
    const client = requireClient();
    const { error } = await client.from("huddle_events").insert({ huddle_id: huddleId, user_id: userId, kind });
    if (error) console.error(`[huddles] record ${kind} error:`, error);
  } catch (err) {
    console.error(`[huddles] record ${kind} failed:`, err);
  }
}

/** Active (live) huddles visible to the viewer, for the dashboard home. */
export async function listActiveHuddles(viewerId: string): Promise<HuddleRow[]> {
  const { live } = await listHuddles("live", viewerId);
  return live;
}

/**
 * Create a huddle from already-validated input, with its intent tags and invitees.
 * The huddle row, tags and invites are written in order; if a later write fails the
 * huddle row is removed again so no half-built huddle is left behind.
 */
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
    mode: input.mode,
    waiting_room: input.waiting_room,
  };
  const { data, error } = await client.from("huddles").insert(row).select("*").single();
  if (error || !data) throw new HuddleStoreError("create", error ?? "no row returned");
  const huddle = data as HuddleRow;

  try {
    if (input.intents.length > 0) {
      const { error: tagError } = await client
        .from("huddle_intents")
        .insert(input.intents.map((tag) => ({ huddle_id: huddle.id, tag })));
      if (tagError) throw new HuddleStoreError("create intents", tagError);
    }
    if (input.invitee_ids.length > 0) {
      await addInvites(huddle.id, createdBy, input.invitee_ids);
    }
  } catch (err) {
    await client.from("huddles").delete().eq("id", huddle.id);
    throw err;
  }
  return huddle;
}

/** Intent tags for one huddle. */
export async function getIntentTags(huddleId: string): Promise<string[]> {
  return (await fetchIntentTags([huddleId])).get(huddleId) ?? [];
}

/** Whether two users are connected. connections stores each pair once, smaller id first. */
export async function isConnectedTo(userA: string, userB: string): Promise<boolean> {
  if (!isUuid(userA) || !isUuid(userB) || userA === userB) return false;
  const [low, high] = [userA, userB].sort();
  const client = requireClient();
  const { data, error } = await client
    .from("connections")
    .select("id")
    .eq("user_id", low)
    .eq("connected_user_id", high)
    .maybeSingle();
  if (error) throw new HuddleStoreError("check connection", error);
  return data != null;
}

/** The viewer's active seat in a huddle, or null when they are not in it. */
export type Membership = {
  role: "host" | "co_host" | "participant";
  admitted: boolean;
  can_speak: boolean;
  can_share_screen: boolean;
  is_muted: boolean;
};

export async function getMembership(huddleId: string, userId: string): Promise<Membership | null> {
  if (!isUuid(huddleId) || !isUuid(userId)) return null;
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_participants")
    .select("role, admitted, can_speak, can_share_screen, is_muted")
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw new HuddleStoreError("membership", error);
  return (data as Membership | null) ?? null;
}

/** Invite connected users to a huddle. Callers check the inviter's rights and the connections. */
export async function addInvites(huddleId: string, invitedBy: string, inviteeIds: string[]): Promise<void> {
  if (inviteeIds.length === 0) return;
  const client = requireClient();
  const { error } = await client
    .from("huddle_invites")
    .upsert(inviteeIds.map((id) => ({ huddle_id: huddleId, invitee_id: id, invited_by: invitedBy })), {
      onConflict: "huddle_id,invitee_id",
    });
  if (error) throw new HuddleStoreError("invite", error);
}

/** Everyone in a huddle who has not left: admitted participants and the waiting room. */
export async function listMembers(huddleId: string): Promise<
  {
    user_id: string;
    username: string | null;
    avatar_url: string | null;
    role: string;
    admitted: boolean;
    can_speak: boolean;
    can_share_screen: boolean;
    is_muted: boolean;
    joined_at: string;
  }[]
> {
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_participants")
    .select("user_id, role, admitted, can_speak, can_share_screen, is_muted, joined_at")
    .eq("huddle_id", huddleId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw new HuddleStoreError("members", error);
  const rows = (data ?? []) as {
    user_id: string;
    role: string;
    admitted: boolean;
    can_speak: boolean;
    can_share_screen: boolean;
    is_muted: boolean;
    joined_at: string;
  }[];
  if (rows.length === 0) return [];
  const { data: users, error: userError } = await client
    .from("users")
    .select("id, username, avatar_url")
    .in("id", rows.map((r) => r.user_id));
  if (userError) throw new HuddleStoreError("member names", userError);
  const names = new Map(((users ?? []) as { id: string; username: string | null; avatar_url: string | null }[]).map((u) => [u.id, u]));
  return rows.map((r) => ({
    ...r,
    username: names.get(r.user_id)?.username ?? null,
    avatar_url: names.get(r.user_id)?.avatar_url ?? null,
  }));
}

/**
 * Admit someone waiting in the waiting room. Takes an admitted seat, so the room's capacity
 * applies. The first admitted person starts the huddle.
 */
export async function admitMember(huddleId: string, userId: string): Promise<"ok" | "full" | "not_waiting" | "not_found"> {
  const client = requireClient();
  const huddle = await getHuddleById(huddleId);
  if (!huddle) return "not_found";
  const { data: seat, error: seatError } = await client
    .from("huddle_participants")
    .select("id, admitted")
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (seatError) throw new HuddleStoreError("admit lookup", seatError);
  if (!seat || seat.admitted) return "not_waiting";

  const { count, error: countError } = await client
    .from("huddle_participants")
    .select("id", { count: "exact", head: true })
    .eq("huddle_id", huddleId)
    .is("left_at", null)
    .eq("admitted", true);
  if (countError) throw new HuddleStoreError("admit count", countError);
  if ((count ?? 0) >= huddle.max_participants) return "full";

  const { error } = await client
    .from("huddle_participants")
    .update({ admitted: true })
    .eq("id", seat.id);
  if (error) throw new HuddleStoreError("admit", error);
  if (huddle.started_at == null) {
    const { error: startError } = await client
      .from("huddles")
      .update({ started_at: new Date().toISOString() })
      .eq("id", huddleId)
      .is("started_at", null);
    if (startError) throw new HuddleStoreError("start", startError);
  }
  return "ok";
}

/** Change a member's role or permissions. Only the fields given are changed. */
export async function updateMember(
  huddleId: string,
  userId: string,
  patch: Partial<{ role: "co_host" | "participant"; can_speak: boolean; can_share_screen: boolean; is_muted: boolean }>
): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from("huddle_participants")
    .update(patch)
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .select("id");
  if (error) throw new HuddleStoreError("update member", error);
  return (data ?? []).length > 0;
}

/** Remove someone from the room. Their seat is freed and their time is recorded. */
export async function removeMember(huddleId: string, userId: string): Promise<boolean> {
  const client = requireClient();
  const now = new Date();
  const { data: seat, error: seatError } = await client
    .from("huddle_participants")
    .select("id, joined_at")
    .eq("huddle_id", huddleId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (seatError) throw new HuddleStoreError("remove lookup", seatError);
  if (!seat) return false;
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(seat.joined_at as string)) / 1000));
  const { error } = await client
    .from("huddle_participants")
    .update({ left_at: now.toISOString(), duration_seconds: seconds })
    .eq("id", seat.id);
  if (error) throw new HuddleStoreError("remove", error);
  await recordHuddleEvent(huddleId, userId, "leave");
  return true;
}

/** Turn the waiting room on or off. */
export async function setWaitingRoom(huddleId: string, enabled: boolean): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("huddles").update({ waiting_room: enabled }).eq("id", huddleId);
  if (error) throw new HuddleStoreError("waiting room", error);
}

/** Record the promotion media uploaded for a huddle. */
export async function setHuddleMedia(
  huddleId: string,
  path: string | null,
  type: "image" | "video" | "audio" | null
): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("huddles").update({ media_path: path, media_type: type }).eq("id", huddleId);
  if (error) throw new HuddleStoreError("media", error);
}

/** Upload promotion media for a huddle. Returns the storage path. */
export async function uploadHuddleMedia(huddleId: string, body: Buffer, contentType: string, extension: string): Promise<string> {
  const client = requireClient();
  const path = `${huddleId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from(HUDDLE_MEDIA_BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new HuddleStoreError("upload media", error);
  return path;
}

/** Public URL for a stored promotion file. */
export function huddleMediaUrl(path: string): string {
  const client = requireClient();
  const { data } = client.storage.from(HUDDLE_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export const HUDDLE_MEDIA_BUCKET = "huddle-media";

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
    .is("left_at", null)
    .eq("admitted", true);
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
    .eq("admitted", true)
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
  if (status === "ok") {
    await recordHuddleEvent(huddleId, userId, "join");
    return { ok: true, waiting: false };
  }
  if (status === "waiting") return { ok: true, waiting: true };
  if (status === "not_found" || status === "ended" || status === "not_started" || status === "full") {
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
  if (status === "ok") {
    await recordHuddleEvent(huddleId, userId, "leave");
    return { ok: true };
  }
  if (status === "not_found" || status === "not_participant") {
    return { ok: false, reason: status, message: LEAVE_FAILURE_MESSAGES[status] };
  }
  throw new HuddleStoreError("leave", `unexpected leave_huddle result: ${String(status)}`);
}
