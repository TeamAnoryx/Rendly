/**
 * Spark: presence, 1:1 matching (text or video) on 1..5 intents, and live dashboard stats.
 * Uses Supabase; tables user_presence and match_queue; RPCs match_waiting_user and
 * dashboard_match_stats (see 20250615_spark_presence_trending.sql and 20250625_spark_v2.sql).
 *
 * A match charges each side its own cost once, inside match_waiting_user. The views returned
 * here never carry the partner's user id, avatar or conversation id; the username only when
 * the partner matched publicly.
 *
 * Database failures throw SparkStoreError (500); a missing v2 schema throws
 * SparkUnavailableError (503) so a deploy before the migration does not look like an outage.
 */

import { supabase } from "./supabase-users";
import { getBalance } from "./points";
import {
  isCallInitiator,
  isMissingSchemaError,
  isSparkPreset,
  partnerDisplayName,
  sharedIntents,
  sparkMatchCost,
  type MatchIntent,
  type MatchMode,
  type MatchRequest,
} from "./spark-rules";

/** A user with no heartbeat for this long is treated as offline. */
export const ONLINE_WINDOW_SECONDS = 60;
/** A matched result stays visible for this long, so a slow poll still sees its match. */
const RECENT_MATCH_WINDOW_MINUTES = 5;
/** A public partner can be invited to connect for this long after the match. */
const INVITE_WINDOW_HOURS = 3;

export class SparkStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[spark] ${operation} failed`);
    this.name = "SparkStoreError";
    console.error(`[spark] ${operation} error:`, cause);
  }
}

/** The Spark v2 migration has not been applied (unknown RPC or column). */
export class SparkUnavailableError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[spark] ${operation} unavailable`);
    this.name = "SparkUnavailableError";
    console.error(`[spark] ${operation} schema missing:`, (cause as { code?: string })?.code ?? cause);
  }
}

/** A non-preset intent the user does not hold. */
export class SparkIntentNotHeldError extends Error {
  constructor(public readonly intent: string) {
    super(`Add ${intent} to your intents first`);
    this.name = "SparkIntentNotHeldError";
  }
}

/** The user already has a waiting row (a concurrent enqueue won the unique index). */
export class SparkAlreadySearchingError extends Error {
  constructor() {
    super("You are already searching");
    this.name = "SparkAlreadySearchingError";
  }
}

/** The user cannot pay for the match they asked for. */
export class SparkInsufficientError extends Error {
  constructor(public readonly cost: number, public readonly balance: number) {
    super("Not enough Rendly Tokens");
    this.name = "SparkInsufficientError";
  }
}

function storeError(operation: string, error: unknown): Error {
  return isMissingSchemaError(error) ? new SparkUnavailableError(operation, error) : new SparkStoreError(operation, error);
}

export type MatchPartnerView = {
  /** '@username' when the partner matched publicly, '@Anonymous' otherwise. */
  display_name: string;
  anonymous: boolean;
  note: string | null;
  can_invite: boolean;
};

export type MatchView =
  | { status: "idle" }
  | { status: "waiting"; queue_id: string; mode: MatchMode; intents: MatchIntent[]; cost: number; waited_seconds: number }
  | { status: "insufficient"; cost: number; balance: number }
  | {
      status: "matched";
      mode: MatchMode;
      shared_intents: MatchIntent[];
      /** Only the initiator starts the video call, so the other side waits for the offer. */
      initiator: boolean;
      cost_charged: number;
      partner: MatchPartnerView;
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

function partnerView(anonymous: boolean, username: string | null | undefined, note: string | null | undefined): MatchPartnerView {
  return {
    display_name: partnerDisplayName(anonymous, username),
    anonymous,
    note: note ?? null,
    can_invite: !anonymous,
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
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

/**
 * End the caller's latest matched pairing (last INVITE_WINDOW_HOURS): sets ended_at on their
 * row and on the partner's row that points back at them, so neither side can rejoin the
 * Spark room or fetch relay credentials for it. Returns true when a pairing was ended.
 */
export async function endLatestPairing(userId: string): Promise<boolean> {
  const client = requireClient();
  const since = new Date(Date.now() - INVITE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data: own, error } = await client
    .from("match_queue")
    .select("id, partner_user_id, ended_at")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("latest pairing", error);
  if (!own || own.ended_at) return false;
  const ids = [own.id as string];
  const partnerId = own.partner_user_id as string | null;
  if (partnerId) {
    const { data: theirs, error: partnerError } = await client
      .from("match_queue")
      .select("id")
      .eq("user_id", partnerId)
      .eq("status", "matched")
      .eq("partner_user_id", userId)
      .gte("matched_at", since)
      .order("matched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (partnerError) throw storeError("partner pairing", partnerError);
    if (theirs) ids.push(theirs.id as string);
  }
  const { error: endError } = await client
    .from("match_queue")
    .update({ ended_at: new Date().toISOString() })
    .in("id", ids)
    .is("ended_at", null);
  if (endError) throw storeError("end pairing", endError);
  return true;
}

/**
 * True when the caller has a matched pairing within INVITE_WINDOW_HOURS that has not been
 * ended (the gate for relay ICE credentials).
 */
export async function hasActivePairing(userId: string): Promise<boolean> {
  const client = requireClient();
  const since = new Date(Date.now() - INVITE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("match_queue")
    .select("id, ended_at")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("active pairing", error);
  return !!data && !data.ended_at;
}

/** Throws SparkIntentNotHeldError for the first non-preset intent the user does not hold. */
async function assertIntentsHeld(userId: string, intents: readonly string[]): Promise<void> {
  const custom = intents.filter((x) => !isSparkPreset(x));
  if (custom.length === 0) return;
  const client = requireClient();
  const { data: held, error } = await client.from("active_user_intents").select("intent_id").eq("user_id", userId);
  if (error) throw storeError("held intents", error);
  const ids = Array.from(new Set(((held ?? []) as { intent_id: string }[]).map((r) => r.intent_id))).slice(0, 500);
  let names = new Set<string>();
  if (ids.length > 0) {
    const { data: rows, error: namesError } = await client.from("intents").select("name").in("id", ids);
    if (namesError) throw storeError("held intent names", namesError);
    names = new Set(((rows ?? []) as { name: string }[]).map((r) => r.name.toLowerCase()));
  }
  const missing = custom.find((x) => !names.has(x.toLowerCase()));
  if (missing) throw new SparkIntentNotHeldError(missing);
}

/**
 * Put the user in the queue, then return their current match state. Checks that every
 * non-preset intent is held and that the balance covers the cost; the database prices the
 * row again (trigger) and re-checks both at match time.
 */
export async function enqueueForMatch(userId: string, req: MatchRequest): Promise<MatchView> {
  const client = requireClient();
  await assertIntentsHeld(userId, req.intents);
  const cost = sparkMatchCost(req.intents);
  const balance = await getBalance(userId);
  if (balance < cost) throw new SparkInsufficientError(cost, balance);
  // One transaction under the user's ledger lock: cancel their waiting rows, insert the new
  // one (priced by the database trigger). uq_match_queue_one_waiting rejects a racing duplicate.
  const { error } = await client.rpc("spark_enqueue", {
    p_user_id: userId,
    p_mode: req.mode,
    p_intents: req.intents,
    p_note: req.note,
    p_anonymous: req.anonymous,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new SparkAlreadySearchingError();
    throw storeError("enqueue", error);
  }
  return getMatchStatus(userId);
}

type MatchRpcResult = {
  status?: string;
  cost?: number;
  balance?: number;
  mode?: MatchMode;
  shared_intents?: unknown;
  partner_note?: string | null;
  partner_anonymous?: boolean;
  partner_username?: string | null;
  initiator?: boolean;
  cost_charged?: number;
};

/**
 * Current match state for the user. Each call also tries to pair a waiting user, so a
 * pair that missed each other at enqueue time is matched on the next poll.
 */
export async function getMatchStatus(userId: string): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client.rpc("match_waiting_user", { p_user_id: userId });
  if (error) throw storeError("match", error);
  const result = (data ?? { status: "none" }) as MatchRpcResult;

  if (result.status === "matched" && result.mode) {
    const anonymous = result.partner_anonymous !== false;
    return {
      status: "matched",
      mode: result.mode,
      shared_intents: toStringArray(result.shared_intents),
      initiator: result.initiator === true,
      cost_charged: Number(result.cost_charged ?? 0),
      partner: partnerView(anonymous, anonymous ? null : result.partner_username, result.partner_note),
    };
  }
  if (result.status === "insufficient") {
    return { status: "insufficient", cost: Number(result.cost ?? 0), balance: Number(result.balance ?? 0) };
  }
  if (result.status === "waiting") {
    return waitingView(userId);
  }
  return recentView(userId);
}

async function waitingView(userId: string): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client
    .from("match_queue")
    .select("id, mode, intents, cost, enqueued_at")
    .eq("user_id", userId)
    .eq("status", "waiting")
    .order("enqueued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("waiting entry", error);
  if (!data) return { status: "idle" };
  const waited = Math.max(0, Math.floor((Date.now() - Date.parse(data.enqueued_at as string)) / 1000));
  return {
    status: "waiting",
    queue_id: data.id as string,
    mode: data.mode as MatchMode,
    intents: toStringArray(data.intents),
    cost: Number(data.cost ?? 0),
    waited_seconds: waited,
  };
}

type OwnQueueRow = {
  id: string;
  status: string;
  partner_user_id: string | null;
  mode: MatchMode;
  intents: unknown;
  cost: number | null;
  charged: boolean | null;
  cancel_reason: string | null;
  matched_at: string | null;
  ended_at?: string | null;
};

/** The partner's matched row for this pairing (their note and anonymous flag). */
async function fetchPartnerRow(
  userId: string,
  partnerId: string,
  sinceIso: string
): Promise<{ note: string | null; anonymous: boolean; intents: unknown } | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("match_queue")
    .select("note, anonymous, intents")
    .eq("user_id", partnerId)
    .eq("status", "matched")
    .eq("partner_user_id", userId)
    .gte("matched_at", sinceIso)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("partner entry", error);
  return data as { note: string | null; anonymous: boolean; intents: unknown } | null;
}

/** No waiting entry: the user may have just been matched (or dropped as insufficient) by someone else's poll. */
async function recentView(userId: string): Promise<MatchView> {
  const client = requireClient();
  const cutoff = new Date(Date.now() - RECENT_MATCH_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("match_queue")
    .select("id, status, partner_user_id, mode, intents, cost, charged, cancel_reason, matched_at, ended_at")
    .eq("user_id", userId)
    .gte("enqueued_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("enqueued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("recent match", error);
  const own = data as OwnQueueRow | null;
  if (!own) return { status: "idle" };

  if (own.status === "cancelled" && own.cancel_reason === "insufficient") {
    return { status: "insufficient", cost: Number(own.cost ?? 0), balance: await getBalance(userId) };
  }
  // An ended pairing (Skip / Leave) is over: show idle rather than the old match.
  if (own.status !== "matched" || own.ended_at || !own.partner_user_id || !own.matched_at || Date.parse(own.matched_at) < Date.parse(cutoff)) {
    return { status: "idle" };
  }
  const partner = await fetchPartnerRow(userId, own.partner_user_id, cutoff);
  if (!partner) return { status: "idle" };
  const anonymous = partner.anonymous !== false;
  let username: string | null = null;
  if (!anonymous) {
    const { data: user, error: userError } = await client.from("users").select("username").eq("id", own.partner_user_id).maybeSingle();
    if (userError) throw storeError("partner name", userError);
    username = (user?.username as string | null | undefined) ?? null;
  }
  return {
    status: "matched",
    mode: own.mode,
    shared_intents: sharedIntents(toStringArray(own.intents), toStringArray(partner.intents)),
    initiator: isCallInitiator(userId, own.partner_user_id),
    cost_charged: own.charged ? Number(own.cost ?? 0) : 0,
    partner: partnerView(anonymous, username, partner.note),
  };
}

export type InvitablePartner = { status: "ok"; partnerId: string } | { status: "none" | "anonymous" };

/**
 * The partner of the caller's latest match within the last 3 hours, if they matched publicly.
 * Resolved server-side so the client never needs (or learns) the partner's id.
 */
export async function findInvitablePartner(userId: string): Promise<InvitablePartner> {
  const client = requireClient();
  const since = new Date(Date.now() - INVITE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("match_queue")
    .select("partner_user_id")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("invite match", error);
  const partnerId = (data?.partner_user_id as string | null | undefined) ?? null;
  if (!partnerId) return { status: "none" };
  const partner = await fetchPartnerRow(userId, partnerId, since);
  if (!partner) return { status: "none" };
  if (partner.anonymous !== false) return { status: "anonymous" };
  return { status: "ok", partnerId };
}
