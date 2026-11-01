/**
 * Points: a ledger (points_ledger) where every change is a row, and a balance that is
 * the sum (user_points_totals). Points come from the signup bonus and host awards in
 * huddles with rewards on. There are no transfers between users.
 */

import { supabase } from "./supabase-users";

const LEADERBOARD_SIZE = 20;
const HISTORY_SIZE = 20;

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

export type PointsEntry = { amount: number; reason: string; note: string | null; huddle_id: string | null; created_at: string };

export type PointsSummary = { total: number; rank: number | null; history: PointsEntry[] };

/** Balance, rank (1 = most points) and recent history for one user. */
export async function getPointsSummary(userId: string): Promise<PointsSummary> {
  const client = requireClient();
  const { data: mine, error: mineError } = await client
    .from("user_points_totals")
    .select("total")
    .eq("user_id", userId)
    .maybeSingle();
  if (mineError) throw new PointsStoreError("balance", mineError);
  const total = Number((mine as { total?: number } | null)?.total ?? 0);

  let rank: number | null = null;
  if (mine) {
    const { count, error: rankError } = await client
      .from("user_points_totals")
      .select("user_id", { count: "exact", head: true })
      .gt("total", total);
    if (rankError) throw new PointsStoreError("rank", rankError);
    rank = (count ?? 0) + 1;
  }

  const { data: history, error: historyError } = await client
    .from("points_ledger")
    .select("amount, reason, note, huddle_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_SIZE);
  if (historyError) throw new PointsStoreError("history", historyError);

  return { total, rank, history: (history ?? []) as PointsEntry[] };
}

export type LeaderboardRow = { rank: number; user_id: string; username: string | null; avatar_url: string | null; total: number };

/** The top users by points. */
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("user_points_totals")
    .select("user_id, total")
    .order("total", { ascending: false })
    .limit(LEADERBOARD_SIZE);
  if (error) throw new PointsStoreError("leaderboard", error);
  const rows = (data ?? []) as { user_id: string; total: number }[];
  if (rows.length === 0) return [];
  const { data: users, error: userError } = await client
    .from("users")
    .select("id, username, avatar_url")
    .in("id", rows.map((r) => r.user_id));
  if (userError) throw new PointsStoreError("leaderboard names", userError);
  const byId = new Map(((users ?? []) as { id: string; username: string | null; avatar_url: string | null }[]).map((u) => [u.id, u]));
  return rows.map((r, i) => ({
    rank: i + 1,
    user_id: r.user_id,
    username: byId.get(r.user_id)?.username ?? null,
    avatar_url: byId.get(r.user_id)?.avatar_url ?? null,
    total: Number(r.total),
  }));
}

export type AwardOutcome = "ok" | "not_found" | "not_host" | "rewards_off" | "not_in_room" | "bad_amount";

/** The host awards points to someone in the room. Rules are enforced in award_huddle_points. */
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
  const outcome = data as AwardOutcome;
  if (!["ok", "not_found", "not_host", "rewards_off", "not_in_room", "bad_amount"].includes(outcome)) {
    throw new PointsStoreError("award", `unexpected result: ${String(data)}`);
  }
  return outcome;
}
