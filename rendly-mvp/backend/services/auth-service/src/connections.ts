/**
 * Connection invites, connections, and user blocks.
 * Uses Supabase; tables: connection_invites, connections, user_blocks.
 */

import { supabase } from "./supabase-users";
import { notifyUser } from "./notifications";

export type ConnectionInviteRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at: string;
};

export type ConnectionRow = {
  id: string;
  user_id: string;
  connected_user_id: string;
  created_at: string;
};

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** List invites where user is sender or receiver. */
export async function listInvitesForUser(userId: string): Promise<ConnectionInviteRow[]> {
  if (!supabase || !userId) return [];
  const { data: sent } = await supabase
    .from("connection_invites")
    .select("*")
    .eq("from_user_id", userId)
    .order("created_at", { ascending: false });
  const { data: received } = await supabase
    .from("connection_invites")
    .select("*")
    .eq("to_user_id", userId)
    .order("created_at", { ascending: false });
  const combined = [...(sent ?? []), ...(received ?? [])];
  combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return combined as ConnectionInviteRow[];
}

/** Create a pending invite. Fails if already exists (unique). */
export async function createInvite(fromUserId: string, toUserId: string): Promise<{ id: string } | null> {
  if (!supabase || !fromUserId || !toUserId || fromUserId === toUserId) return null;
  const { data, error } = await supabase
    .from("connection_invites")
    .insert({
      from_user_id: fromUserId,
      to_user_id: toUserId,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return null;
  return data as { id: string };
}

/** Get invite by id (must involve userId as sender or receiver). */
export async function getInviteById(inviteId: string, userId: string): Promise<ConnectionInviteRow | null> {
  if (!supabase || !inviteId || !userId) return null;
  const { data } = await supabase.from("connection_invites").select("*").eq("id", inviteId).maybeSingle();
  if (!data || ((data as ConnectionInviteRow).from_user_id !== userId && (data as ConnectionInviteRow).to_user_id !== userId))
    return null;
  return data as ConnectionInviteRow;
}

/** Update invite status. */
export async function updateInviteStatus(inviteId: string, status: "accepted" | "rejected"): Promise<boolean> {
  if (!supabase || !inviteId) return false;
  const { error } = await supabase
    .from("connection_invites")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", inviteId);
  return !error;
}

/** Check if there is a pending invite between the two users (from -> to). */
export async function hasPendingInvite(fromUserId: string, toUserId: string): Promise<boolean> {
  if (!supabase || !fromUserId || !toUserId) return false;
  const { data } = await supabase
    .from("connection_invites")
    .select("id")
    .eq("from_user_id", fromUserId)
    .eq("to_user_id", toUserId)
    .eq("status", "pending")
    .maybeSingle();
  return !!data;
}

/** Create connection row (ordered pair). */
export async function createConnection(userIdA: string, userIdB: string): Promise<boolean> {
  if (!supabase || !userIdA || !userIdB || userIdA === userIdB) return false;
  const [u1, u2] = orderedPair(userIdA, userIdB);
  const { error } = await supabase.from("connections").insert({ user_id: u1, connected_user_id: u2 });
  return !error;
}

/** List connection rows where userId is either user_id or connected_user_id; return other user id and created_at. */
export async function listConnectionsForUser(userId: string): Promise<{ connected_user_id: string; created_at: string }[]> {
  if (!supabase || !userId) return [];
  const { data: asUser } = await supabase
    .from("connections")
    .select("connected_user_id, created_at")
    .eq("user_id", userId);
  const { data: asConnected } = await supabase
    .from("connections")
    .select("user_id, created_at")
    .eq("connected_user_id", userId);
  const out: { connected_user_id: string; created_at: string }[] = [];
  for (const r of asUser ?? []) {
    out.push({ connected_user_id: (r as { connected_user_id: string }).connected_user_id, created_at: (r as { created_at: string }).created_at });
  }
  for (const r of asConnected ?? []) {
    out.push({ connected_user_id: (r as { user_id: string }).user_id, created_at: (r as { created_at: string }).created_at });
  }
  return out;
}

/** Check if two users are connected. */
export async function areConnected(userIdA: string, userIdB: string): Promise<boolean> {
  if (!supabase || !userIdA || !userIdB || userIdA === userIdB) return false;
  const [u1, u2] = orderedPair(userIdA, userIdB);
  const { data } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", u1)
    .eq("connected_user_id", u2)
    .maybeSingle();
  return !!data;
}

/** Remove connection between two users. */
export async function deleteConnection(userIdA: string, userIdB: string): Promise<boolean> {
  if (!supabase || !userIdA || !userIdB) return false;
  const [u1, u2] = orderedPair(userIdA, userIdB);
  const { error } = await supabase.from("connections").delete().eq("user_id", u1).eq("connected_user_id", u2);
  return !error;
}

/** Block a user. */
export async function createBlock(blockerId: string, blockedId: string): Promise<boolean> {
  if (!supabase || !blockerId || !blockedId || blockerId === blockedId) return false;
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: blockerId, blocked_id: blockedId });
  return !error;
}

/** Unblock a user. */
export async function deleteBlock(blockerId: string, blockedId: string): Promise<boolean> {
  if (!supabase || !blockerId || !blockedId) return false;
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
  return !error;
}

/** List user ids that blocker has blocked. */
export async function listBlockedIds(blockerId: string): Promise<string[]> {
  if (!supabase || !blockerId) return [];
  const { data } = await supabase.from("user_blocks").select("blocked_id").eq("blocker_id", blockerId);
  return (data ?? []).map((r: { blocked_id: string }) => r.blocked_id);
}

/** Check if blocker has blocked blockedId. */
export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  if (!supabase || !blockerId || !blockedId) return false;
  const { data } = await supabase
    .from("user_blocks")
    .select("id")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .maybeSingle();
  return !!data;
}

export type SendInviteOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "self" | "blocked_by_me" | "blocked_by_them" | "connected" | "pending" | "failed" };

/**
 * Send a connection invite from one user to another and notify the recipient. Shared by
 * POST /api/users/me/connection-invites and POST /api/match/invite; callers map the failure
 * reasons to their own HTTP answers.
 */
export async function sendConnectionInvite(
  from: { id: string; username: string | null | undefined },
  toUserId: string
): Promise<SendInviteOutcome> {
  if (!from.id || !toUserId) return { ok: false, reason: "failed" };
  if (from.id === toUserId) return { ok: false, reason: "self" };
  if (await isBlocked(from.id, toUserId)) return { ok: false, reason: "blocked_by_me" };
  if (await isBlocked(toUserId, from.id)) return { ok: false, reason: "blocked_by_them" };
  if (await areConnected(from.id, toUserId)) return { ok: false, reason: "connected" };
  if (await hasPendingInvite(from.id, toUserId)) return { ok: false, reason: "pending" };
  const created = await createInvite(from.id, toUserId);
  if (!created) return { ok: false, reason: "failed" };
  await notifyUser(toUserId, {
    type: "connection_request",
    title: `${from.username ? `@${from.username}` : "Someone"} wants to connect`,
    body: "Open your profile to accept or decline.",
    payload: { invite_id: created.id, from_user_id: from.id },
  });
  return { ok: true, id: created.id };
}
