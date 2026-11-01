/**
 * Spark: presence, random 1:1 matching (text or video) and live dashboard stats.
 * Uses Supabase; tables user_presence and match_queue; RPCs match_waiting_user
 * and dashboard_match_stats (see 20250615_spark_presence_trending.sql).
 *
 * Database failures throw SparkStoreError so callers answer 500 instead of
 * reporting an outage as "no match" or zero users.
 */

import { supabase } from "./supabase-users";
import { isCallInitiator, whisperConversationId, type MatchIntent, type MatchMode } from "./spark-rules";

/** A user with no heartbeat for this long is treated as offline. */
export const ONLINE_WINDOW_SECONDS = 60;
/** A matched result stays visible for this long, so a slow poll still sees its match. */
const RECENT_MATCH_WINDOW_MINUTES = 5;

export class SparkStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[spark] ${operation} failed`);
    this.name = "SparkStoreError";
    console.error(`[spark] ${operation} error:`, cause);
  }
}

export type MatchPartner = { id: string; username: string | null; avatar_url: string | null };

export type MatchView =
  | { status: "idle" }
  | { status: "waiting"; queue_id: string; mode: MatchMode; intent: MatchIntent; waited_seconds: number }
  | {
      status: "matched";
      mode: MatchMode;
      intent: MatchIntent;
      conversation_id: string;
      /** Only the initiator starts the video call, so the other side waits for the incoming call. */
      initiator: boolean;
      partner: MatchPartner;
    };

export type DashboardStats = {
  onlineUsers: number;
  lookingForMatch: number;
  avgMatchTimeMinutes: number;
};

function requireClient() {
  if (!supabase) throw new SparkStoreError("connect", "Supabase is not configured");
  return supabase;
}

/** Record that the user is online right now. */
export async function recordHeartbeat(userId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from("user_presence")
    .upsert({ user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new SparkStoreError("heartbeat", error);
}

/** Live counts for the dashboard, all computed from current rows. */
export async function getDashboardStats(): Promise<DashboardStats> {
  const client = requireClient();
  const { data, error } = await client.rpc("dashboard_match_stats");
  if (error) throw new SparkStoreError("dashboard stats", error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    onlineUsers: Number(row.online_users ?? 0),
    lookingForMatch: Number(row.looking_for_match ?? 0),
    avgMatchTimeMinutes: row.avg_match_time_minutes == null ? 0 : Number(row.avg_match_time_minutes),
  };
}

/** Cancel any earlier waiting entry for this user. Returns how many were cancelled. */
export async function cancelWaitingEntries(userId: string): Promise<number> {
  const client = requireClient();
  const { data, error } = await client
    .from("match_queue")
    .update({ status: "cancelled" })
    .eq("user_id", userId)
    .eq("status", "waiting")
    .select("id");
  if (error) throw new SparkStoreError("cancel waiting", error);
  return (data ?? []).length;
}

/** Put the user in the queue for this mode and intent, then return their current match state. */
export async function enqueueForMatch(userId: string, mode: MatchMode, intent: MatchIntent): Promise<MatchView> {
  const client = requireClient();
  await cancelWaitingEntries(userId);
  const { error } = await client.from("match_queue").insert({ user_id: userId, mode, intent }).select("id").single();
  if (error) throw new SparkStoreError("enqueue", error);
  return getMatchStatus(userId);
}

/**
 * Current match state for the user. Each call also tries to pair a waiting user, so a
 * pair that missed each other at enqueue time is matched on the next poll.
 */
export async function getMatchStatus(userId: string): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client.rpc("match_waiting_user", { p_user_id: userId });
  if (error) throw new SparkStoreError("match", error);
  const result = (data ?? { status: "none" }) as {
    status: string;
    queue_id?: string;
    partner_user_id?: string;
    mode?: MatchMode;
    intent?: MatchIntent;
  };

  if (result.status === "matched" && result.partner_user_id && result.mode && result.intent) {
    return buildMatched(userId, result.partner_user_id, result.mode, result.intent);
  }
  if (result.status === "waiting") {
    return waitingView(userId);
  }
  // No waiting entry: the user may have just been matched by someone else's poll.
  const cutoff = new Date(Date.now() - RECENT_MATCH_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await client
    .from("match_queue")
    .select("partner_user_id, mode, intent")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", cutoff)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentError) throw new SparkStoreError("recent match", recentError);
  if (recent && recent.partner_user_id) {
    return buildMatched(userId, recent.partner_user_id as string, recent.mode as MatchMode, recent.intent as MatchIntent);
  }
  return { status: "idle" };
}

async function waitingView(userId: string): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client
    .from("match_queue")
    .select("id, mode, intent, enqueued_at")
    .eq("user_id", userId)
    .eq("status", "waiting")
    .order("enqueued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new SparkStoreError("waiting entry", error);
  if (!data) return { status: "idle" };
  const waited = Math.max(0, Math.floor((Date.now() - Date.parse(data.enqueued_at as string)) / 1000));
  return {
    status: "waiting",
    queue_id: data.id as string,
    mode: data.mode as MatchMode,
    intent: data.intent as MatchIntent,
    waited_seconds: waited,
  };
}

async function buildMatched(userId: string, partnerId: string, mode: MatchMode, intent: MatchIntent): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client
    .from("users")
    .select("id, username, avatar_url")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new SparkStoreError("partner lookup", error);
  return {
    status: "matched",
    mode,
    intent,
    conversation_id: whisperConversationId(userId, partnerId),
    initiator: isCallInitiator(userId, partnerId),
    partner: {
      id: partnerId,
      username: (data?.username as string | null | undefined) ?? null,
      avatar_url: (data?.avatar_url as string | null | undefined) ?? null,
    },
  };
}
