/**
 * Rendly Tokens: a ledger (points_ledger) where every change is a row, and a balance that is
 * the sum (user_points_totals). Tokens come from the signup bonus, minted host awards, peer
 * transfers (whispers), host-paid huddle sends and intent purchases / royalties.
 * Every debit runs inside one SQL RPC (see 20250619_tokens_ledger_v2.sql) that locks the payer.
 */

import { supabase } from "./supabase-users";
import type { HuddleSendPurpose } from "./points-rules";

const LEADERBOARD_SIZE = 10;
const SUMMARY_HISTORY_SIZE = 20;
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 100;

export class PointsStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[points] ${operation} failed`);
    this.name = "PointsStoreError";
    console.error(`[points] ${operation} error:`, cause);
  }
}

function requireClient() {
  if (!supabase) throw new PointsStoreError("connect", "Supabase is not configured");
  return supabase;
}

export type PointsCategory = "signup" | "huddle_award" | "huddle_send" | "huddle_tip" | "transfer" | "intent_purchase" | "intent_royalty";

export type PointsEntry = {
  id: string;
  amount: number;
  reason: string;
  category: PointsCategory | string;
  note: string | null;
  huddle_id: string | null;
  counterparty_id: string | null;
  counterparty_username: string | null;
  counterparty_avatar_url: string | null;
  intent_id: string | null;
  intent_name: string | null;
  conversation_id: string | null;
  transfer_id: string | null;
  purpose: string | null;
  created_at: string;
};

export type PointsSummary = { total: number; rank: number | null; history: PointsEntry[] };

type LedgerRow = Omit<PointsEntry, "counterparty_username" | "counterparty_avatar_url" | "intent_name">;

const LEDGER_COLUMNS =
  "id, amount, reason, category, note, huddle_id, counterparty_id, intent_id, conversation_id, transfer_id, purpose, created_at";

type UserName = { id: string; username: string | null; avatar_url: string | null };

/** Usernames and avatars for a set of user ids, in one query. */
async function fetchUserNames(userIds: string[]): Promise<Map<string, UserName>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const client = requireClient();
  const { data, error } = await client.from("users").select("id, username, avatar_url").in("id", ids);
  if (error) throw new PointsStoreError("user names", error);
  return new Map(((data ?? []) as UserName[]).map((u) => [u.id, u]));
}

/** Intent names for a set of intent ids, in one query. */
async function fetchIntentNames(intentIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(intentIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const client = requireClient();
  const { data, error } = await client.from("intents").select("id, name").in("id", ids);
  if (error) throw new PointsStoreError("intent names", error);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
}

/** Attach counterparty and intent names to raw ledger rows. */
async function decorateEntries(rows: LedgerRow[]): Promise<PointsEntry[]> {
  const [users, intents] = await Promise.all([
    fetchUserNames(rows.map((r) => r.counterparty_id).filter((id): id is string => id != null)),
    fetchIntentNames(rows.map((r) => r.intent_id).filter((id): id is string => id != null)),
  ]);
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    counterparty_username: r.counterparty_id ? (users.get(r.counterparty_id)?.username ?? null) : null,
    counterparty_avatar_url: r.counterparty_id ? (users.get(r.counterparty_id)?.avatar_url ?? null) : null,
    intent_name: r.intent_id ? (intents.get(r.intent_id) ?? null) : null,
  }));
}

/** Current balance for one user (0 when they have no ledger rows). */
export async function getBalance(userId: string): Promise<number> {
  const client = requireClient();
  const { data, error } = await client.from("user_points_totals").select("total").eq("user_id", userId).maybeSingle();
  if (error) throw new PointsStoreError("balance", error);
  return Number((data as { total?: number } | null)?.total ?? 0);
}

/** 1-based rank with ties sharing a rank (points_rank_of), or null without ledger rows. */
export async function getRank(userId: string): Promise<number | null> {
  const client = requireClient();
  const { data, error } = await client.rpc("points_rank_of", { p_user_id: userId });
  if (error) throw new PointsStoreError("rank", error);
  return data == null ? null : Number(data);
}

export type PointsHistoryPage = { entries: PointsEntry[]; next_before: string | null };

/**
 * Ledger rows for one user, newest first, as a cursor page on created_at.
 * `before` (ISO) returns rows created strictly before it; next_before is the cursor for the
 * following page, or null when this page was the last one.
 */
export async function getPointsHistory(userId: string, before?: string | null, limit = HISTORY_DEFAULT_LIMIT): Promise<PointsHistoryPage> {
  const client = requireClient();
  const size = Math.min(Math.max(Math.floor(limit) || HISTORY_DEFAULT_LIMIT, 1), HISTORY_MAX_LIMIT);
  let query = client.from("points_ledger").select(LEDGER_COLUMNS).eq("user_id", userId);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(size);
  if (error) throw new PointsStoreError("history", error);
  const rows = (data ?? []) as LedgerRow[];
  const entries = await decorateEntries(rows);
  const last = entries[entries.length - 1];
  return { entries, next_before: entries.length === size && last ? last.created_at : null };
}

/** Balance, rank and recent history for one user. */
export async function getPointsSummary(userId: string): Promise<PointsSummary> {
  const [total, rank, page] = await Promise.all([getBalance(userId), getRank(userId), getPointsHistory(userId, null, SUMMARY_HISTORY_SIZE)]);
  return { total, rank, history: page.entries };
}

export type LeaderboardRow = { rank: number; user_id: string; username: string | null; avatar_url: string | null; total: number };

/** The top users by tokens, with tie-aware ranks (points_leaderboard). */
export async function getLeaderboard(limit = LEADERBOARD_SIZE): Promise<LeaderboardRow[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("points_leaderboard", { p_limit: limit });
  if (error) throw new PointsStoreError("leaderboard", error);
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({
    rank: Number(r.rank),
    user_id: r.user_id,
    username: r.username ?? null,
    avatar_url: r.avatar_url ?? null,
    total: Number(r.total),
  }));
}

export type AwardOutcome = "ok" | "not_found" | "not_host" | "rewards_off" | "not_in_room" | "bad_amount" | "cap_reached";
const AWARD_OUTCOMES: readonly AwardOutcome[] = ["ok", "not_found", "not_host", "rewards_off", "not_in_room", "bad_amount", "cap_reached"];

/**
 * The host awards minted tokens to someone in the room. Rules and the mint caps (2000 per huddle,
 * 1000 per recipient per huddle, 3000 per host per 24 h -> cap_reached) live in award_huddle_points.
 */
export async function awardHuddlePoints(
  huddleId: string,
  hostId: string,
  userId: string,
  amount: number,
  note: string | null
): Promise<AwardOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("award_huddle_points", {
    p_huddle_id: huddleId,
    p_host_id: hostId,
    p_user_id: userId,
    p_amount: amount,
    p_note: note,
  });
  if (error) throw new PointsStoreError("award", error);
  if (!AWARD_OUTCOMES.includes(data as AwardOutcome)) {
    throw new PointsStoreError("award", `unexpected result: ${String(data)}`);
  }
  return data as AwardOutcome;
}

/**
 * too_new: the sender's account is younger than 24 hours.
 * no_relationship: no connection / whisper reply between the pair, a block, or an unknown recipient
 * (one code for all, so user ids cannot be probed).
 */
export type TransferFailure = "bad_amount" | "self" | "bad_input" | "too_new" | "no_relationship" | "insufficient" | "duplicate";
export type TransferOutcome = { status: "ok"; transfer_id: string; balance: number } | { status: TransferFailure };
const TRANSFER_FAILURES: readonly TransferFailure[] = [
  "bad_amount",
  "self",
  "bad_input",
  "too_new",
  "no_relationship",
  "insufficient",
  "duplicate",
];

/** Peer-to-peer send (transfer_tokens). transferId is the caller-generated idempotency key. */
export async function transferTokens(input: {
  fromUserId: string;
  toUserId: string;
  amount: number;
  note: string | null;
  conversationId: string;
  transferId: string;
}): Promise<TransferOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("transfer_tokens", {
    p_from: input.fromUserId,
    p_to: input.toUserId,
    p_amount: input.amount,
    p_note: input.note,
    p_conversation_id: input.conversationId,
    p_transfer_id: input.transferId,
  });
  if (error) throw new PointsStoreError("transfer", error);
  const result = (data ?? {}) as { status?: string; transfer_id?: string; balance?: number };
  if (result.status === "ok" && typeof result.transfer_id === "string") {
    return { status: "ok", transfer_id: result.transfer_id, balance: Number(result.balance ?? 0) };
  }
  if (TRANSFER_FAILURES.includes(result.status as TransferFailure)) return { status: result.status as TransferFailure };
  throw new PointsStoreError("transfer", `unexpected result: ${JSON.stringify(data)}`);
}

export type HuddleSendOutcome =
  | "ok"
  | "not_found"
  | "not_host"
  | "rewards_off"
  | "not_in_room"
  | "bad_amount"
  | "bad_purpose"
  | "note_required"
  | "bad_note"
  | "bad_input"
  | "insufficient"
  | "duplicate";
const HUDDLE_SEND_OUTCOMES: readonly HuddleSendOutcome[] = [
  "ok",
  "not_found",
  "not_host",
  "rewards_off",
  "not_in_room",
  "bad_amount",
  "bad_purpose",
  "note_required",
  "bad_note",
  "bad_input",
  "insufficient",
  "duplicate",
];

/** The host pays a participant from their own balance (huddle_send_tokens). */
export async function huddleSendTokens(input: {
  huddleId: string;
  hostId: string;
  userId: string;
  amount: number;
  purpose: HuddleSendPurpose;
  note: string | null;
  transferId: string;
}): Promise<HuddleSendOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("huddle_send_tokens", {
    p_huddle_id: input.huddleId,
    p_host_id: input.hostId,
    p_user_id: input.userId,
    p_amount: input.amount,
    p_purpose: input.purpose,
    p_note: input.note,
    p_transfer_id: input.transferId,
  });
  if (error) throw new PointsStoreError("huddle send", error);
  if (!HUDDLE_SEND_OUTCOMES.includes(data as HuddleSendOutcome)) {
    throw new PointsStoreError("huddle send", `unexpected result: ${String(data)}`);
  }
  return data as HuddleSendOutcome;
}

export type HuddleTipOutcome =
  | "ok" | "not_found" | "is_host" | "tips_off" | "not_in_room" | "bad_amount" | "bad_note"
  | "bad_input" | "insufficient" | "duplicate";

const HUDDLE_TIP_OUTCOMES: HuddleTipOutcome[] = [
  "ok", "not_found", "is_host", "tips_off", "not_in_room", "bad_amount", "bad_note", "bad_input", "insufficient", "duplicate",
];

/** A participant sends tokens to the huddle host from their own balance (huddle_tip_host). */
export async function huddleTipHost(input: {
  huddleId: string;
  senderId: string;
  amount: number;
  note: string | null;
  transferId: string;
}): Promise<HuddleTipOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("huddle_tip_host", {
    p_huddle_id: input.huddleId,
    p_sender_id: input.senderId,
    p_amount: input.amount,
    p_note: input.note,
    p_transfer_id: input.transferId,
  });
  if (error) throw new PointsStoreError("huddle tip", error);
  if (!HUDDLE_TIP_OUTCOMES.includes(data as HuddleTipOutcome)) {
    throw new PointsStoreError("huddle tip", `unexpected result: ${String(data)}`);
  }
  return data as HuddleTipOutcome;
}

/** The caller's own debit row of one transfer, used to answer an idempotent retry. */
export type OwnDebit = {
  amount: number;
  counterparty_id: string | null;
  huddle_id: string | null;
  intent_id: string | null;
  conversation_id: string | null;
  purpose: string | null;
};

/**
 * Find the debit row of `transferId` that belongs to `userId` in `category`. Returns null when the
 * transfer id was used by someone else (or another kind of operation), so a retry can never read
 * another user's transfer.
 */
export async function findOwnDebit(userId: string, transferId: string, category: PointsCategory): Promise<OwnDebit | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("points_ledger")
    .select("amount, counterparty_id, huddle_id, intent_id, conversation_id, purpose")
    .eq("transfer_id", transferId)
    .eq("user_id", userId)
    .eq("category", category)
    .lt("amount", 0)
    .maybeSingle();
  if (error) throw new PointsStoreError("own debit", error);
  if (!data) return null;
  const row = data as OwnDebit;
  return { ...row, amount: Math.abs(Number(row.amount)) };
}
