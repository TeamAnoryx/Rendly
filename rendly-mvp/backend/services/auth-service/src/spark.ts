/**
 * Spark: presence, 1:1 matching (text or video) on 1..5 intents, and live dashboard stats.
 * Uses Supabase; tables user_presence and match_queue; RPCs match_waiting_user and
 * dashboard_match_stats (see 20250615_spark_presence_trending.sql and 20250625_spark_v2.sql).
 *
 * A match charges each side its own cost once, but only after it has lasted 30 seconds
 * (spark_settle_pairing); ending earlier waives it for both. Each user gets
 * SPARK_MATCHES_PER_WINDOW matches per rolling SPARK_WINDOW_MINUTES. The views returned
 * here never carry the partner's user id, avatar or conversation id; the username only when
 * the partner matched publicly.
 *
 * Database failures throw SparkStoreError (500); a missing v2 schema throws
 * SparkUnavailableError (503) so a deploy before the migration does not look like an outage.
 */

import { supabase } from "./supabase-users";
import { getBalance } from "./points";
import {
  chargeSettlesAt,
  computeSparkLimits,
  isCallInitiator,
  isMissingSchemaError,
  isRateLimited,
  isSparkPreset,
  partnerDisplayName,
  sharedIntents,
  sparkMatchCost,
  SPARK_WINDOW_MINUTES,
  type MatchIntent,
  type MatchedVia,
  type MatchMode,
  type MatchRequest,
  type SparkCharge,
  type SparkChargeState,
  type SparkLimits,
} from "./spark-rules";

export type { MatchedVia, SparkCharge, SparkChargeState, SparkLimits } from "./spark-rules";

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

/** The user has used every match in the current rolling window. */
export class SparkRateLimitedError extends Error {
  constructor(public readonly limits: SparkLimits) {
    super("Match limit reached, try again later");
    this.name = "SparkRateLimitedError";
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
      /** 0 while the charge is pending or waived; the cost once charged. */
      cost_charged: number;
      charge: SparkCharge;
      partner: MatchPartnerView;
      /** 'default' when the Default fallback made the pair (charge.cost then includes SPARK_DEFAULT_FEE). */
      matched_via: MatchedVia;
    };

export type MatchStatusView = MatchView & { limits: SparkLimits };

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
 * End the caller's latest matched pairing (last INVITE_WINDOW_HOURS) and settle its charge:
 * charged for both sides when it lasted 30s, waived otherwise. Sets ended_at on both rows so
 * neither side can rejoin the Spark room or fetch relay credentials for it.
 * Returns true when a pairing was ended.
 */
export async function endLatestPairing(userId: string): Promise<boolean> {
  // An already-ended pairing was settled by whoever ended it; keep the old "false" answer.
  if (!(await hasActivePairing(userId))) return false;
  const result = await settlePairing(userId, true);
  return result.ended;
}

/** Match allowance for the rolling window plus the current balance. */
export async function getSparkLimits(userId: string): Promise<SparkLimits> {
  const client = requireClient();
  const now = new Date();
  const since = new Date(now.getTime() - SPARK_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("match_queue")
    .select("matched_at")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(50);
  if (error) throw storeError("match limits", error);
  const matchedAts = ((data ?? []) as { matched_at: string | null }[])
    .map((r) => r.matched_at)
    .filter((x): x is string => typeof x === "string");
  const balance = await getBalance(userId);
  return computeSparkLimits(matchedAts, balance, now);
}

/**
 * Settle the caller's latest pairing: charge both sides once it has lasted 30s, waive when it
 * ended earlier. Idempotent. With end, also ends the pairing. charge is null without a pairing.
 */
export async function settleLatestPairing(
  userId: string,
  opts: { end?: boolean } = {}
): Promise<{ charge: SparkCharge | null; limits: SparkLimits }> {
  const { charge } = await settlePairing(userId, opts.end === true);
  return { charge, limits: await getSparkLimits(userId) };
}

type SettleRpcResult = {
  status?: string;
  queue_id?: string;
  state?: string;
  cost?: number;
  settles_at?: string | null;
  matched_at?: string | null;
  ended?: boolean;
};

function toChargeState(value: unknown): SparkChargeState {
  return value === "charged" || value === "waived" ? value : "pending";
}

async function settlePairing(userId: string, end: boolean): Promise<{ charge: SparkCharge | null; ended: boolean }> {
  const client = requireClient();
  const { data, error } = await client.rpc("spark_settle_pairing", { p_user_id: userId, p_end: end });
  if (error) {
    if (!isMissingSchemaError(error)) throw storeError("settle pairing", error);
    // Deferred-charge migration not applied: v2 charged at pairing time.
    const charge = await legacyLatestCharge(userId);
    const ended = end ? await endPairingLegacy(userId) : false;
    return { charge, ended };
  }
  const result = (data ?? { status: "none" }) as SettleRpcResult;
  if (result.status !== "ok") return { charge: null, ended: false };
  const settlesAt = result.settles_at ?? (result.matched_at ? chargeSettlesAt(result.matched_at) : null);
  return {
    charge: { state: toChargeState(result.state), settles_at: settlesAt, cost: Number(result.cost ?? 0) },
    ended: end && result.ended === true,
  };
}

/** v2 fallback: the latest pairing was charged when it was made. */
async function legacyLatestCharge(userId: string): Promise<SparkCharge | null> {
  const client = requireClient();
  const since = new Date(Date.now() - INVITE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("match_queue")
    .select("cost, charged")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", since)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw storeError("latest charge", error);
  if (!data) return null;
  return { state: "charged", settles_at: null, cost: data.charged ? Number(data.cost ?? 0) : 0 };
}

/** v2 fallback for ending a pairing: sets ended_at on both rows without settling. */
async function endPairingLegacy(userId: string): Promise<boolean> {
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
export async function enqueueForMatch(userId: string, req: MatchRequest): Promise<MatchStatusView> {
  const client = requireClient();
  const limits = await getSparkLimits(userId);
  if (isRateLimited(limits)) throw new SparkRateLimitedError(limits);
  await assertIntentsHeld(userId, req.intents);
  // Skip / Next: an un-ended pairing is ended (and settled) before searching again.
  if (await hasActivePairing(userId)) await endLatestPairing(userId);
  const cost = sparkMatchCost(req.intents);
  const balance = await getBalance(userId);
  if (balance < cost) throw new SparkInsufficientError(cost, balance);
  // One transaction under the user's ledger lock: cancel their waiting rows, insert the new
  // one (priced by the database trigger). uq_match_queue_one_waiting rejects a racing duplicate.
  const args = {
    p_user_id: userId,
    p_mode: req.mode,
    p_intents: req.intents,
    p_note: req.note,
    p_anonymous: req.anonymous,
  };
  let { error } = await client.rpc("spark_enqueue", { ...args, p_match_any: req.match_any });
  // Default-match migration not applied yet: enqueue without the Default flag.
  if (error && isMissingSchemaError(error)) ({ error } = await client.rpc("spark_enqueue", args));
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
  charge_state?: string | null;
  settles_at?: string | null;
  matched_at?: string | null;
  matched_via?: string | null;
};

function toMatchedVia(value: unknown): MatchedVia {
  return value === "default" ? "default" : "intents";
}

/**
 * The charge for a matched pairing. Without charge_state (deferred-charge migration not
 * applied) the v2 behaviour holds: charged at pairing time.
 */
function chargeFrom(
  chargeState: string | null | undefined,
  cost: number,
  costCharged: number,
  settlesAt: string | null | undefined,
  matchedAt: string | null | undefined
): SparkCharge {
  if (chargeState === undefined || chargeState === null) {
    return { state: "charged", settles_at: null, cost: costCharged };
  }
  const settles = settlesAt ?? (matchedAt ? chargeSettlesAt(matchedAt) : null);
  return { state: toChargeState(chargeState), settles_at: settles, cost };
}

/** cost_charged mirrors the charge: the cost once charged, 0 while pending or waived. */
function withCharge(view: Extract<MatchView, { status: "matched" }>, charge: SparkCharge): MatchView {
  return { ...view, charge, cost_charged: charge.state === "charged" ? charge.cost : 0 };
}

/**
 * Current match state for the user, with their match allowance. Each call also tries to pair
 * a waiting user, so a pair that missed each other at enqueue time is matched on the next
 * poll. A pending charge whose 30 seconds have passed is settled here, so charging happens
 * even when the client never calls settle.
 */
export async function getMatchStatus(userId: string): Promise<MatchStatusView> {
  let view = await currentView(userId);
  if (
    view.status === "matched" &&
    view.charge.state === "pending" &&
    view.charge.settles_at !== null &&
    Date.parse(view.charge.settles_at) <= Date.now()
  ) {
    const settled = await settlePairing(userId, false);
    if (settled.charge) view = withCharge(view, settled.charge);
  }
  const limits = await getSparkLimits(userId);
  return { ...view, limits };
}

async function currentView(userId: string): Promise<MatchView> {
  const client = requireClient();
  const { data, error } = await client.rpc("match_waiting_user", { p_user_id: userId });
  if (error) throw storeError("match", error);
  const result = (data ?? { status: "none" }) as MatchRpcResult;

  if (result.status === "matched" && result.mode) {
    const anonymous = result.partner_anonymous !== false;
    const costCharged = Number(result.cost_charged ?? 0);
    const charge = chargeFrom(
      result.charge_state,
      Number(result.cost ?? costCharged),
      costCharged,
      result.settles_at,
      result.matched_at
    );
    return {
      status: "matched",
      mode: result.mode,
      shared_intents: toStringArray(result.shared_intents),
      initiator: result.initiator === true,
      cost_charged: charge.state === "charged" ? charge.cost : 0,
      charge,
      partner: partnerView(anonymous, anonymous ? null : result.partner_username, result.partner_note),
      matched_via: toMatchedVia(result.matched_via),
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
  charge_state?: string | null;
  default_fee?: number | null;
  matched_via?: string | null;
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
  const own = await fetchOwnRecentRow(userId);
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
  const cost = Number(own.cost ?? 0) + Number(own.default_fee ?? 0);
  const charge = chargeFrom(own.charge_state, cost, own.charged ? cost : 0, null, own.matched_at);
  return {
    status: "matched",
    mode: own.mode,
    shared_intents: sharedIntents(toStringArray(own.intents), toStringArray(partner.intents)),
    initiator: isCallInitiator(userId, own.partner_user_id),
    cost_charged: charge.state === "charged" ? charge.cost : 0,
    charge,
    partner: partnerView(anonymous, username, partner.note),
    matched_via: toMatchedVia(own.matched_via),
  };
}

const OWN_ROW_COLUMNS = "id, status, partner_user_id, mode, intents, cost, charged, cancel_reason, matched_at, ended_at";

/** The user's latest queue row (last 24h); retries without charge_state before the deferred-charge migration. */
async function fetchOwnRecentRow(userId: string): Promise<OwnQueueRow | null> {
  const client = requireClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const query = (columns: string) =>
    client
      .from("match_queue")
      .select(columns)
      .eq("user_id", userId)
      .gte("enqueued_at", since)
      .order("enqueued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const full = await query(`${OWN_ROW_COLUMNS}, charge_state, default_fee, matched_via`);
  if (!full.error) return full.data as unknown as OwnQueueRow | null;
  if (!isMissingSchemaError(full.error)) throw storeError("recent match", full.error);
  // Default-match migration not applied yet.
  const first = await query(`${OWN_ROW_COLUMNS}, charge_state`);
  if (!first.error) return first.data as unknown as OwnQueueRow | null;
  if (!isMissingSchemaError(first.error)) throw storeError("recent match", first.error);
  const legacy = await query(OWN_ROW_COLUMNS);
  if (legacy.error) throw storeError("recent match", legacy.error);
  return legacy.data as unknown as OwnQueueRow | null;
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
