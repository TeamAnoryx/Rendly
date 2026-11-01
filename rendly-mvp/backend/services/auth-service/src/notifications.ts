/**
 * In-app notifications. Unread rows (read_at IS NULL) persist, so anything a user has
 * not seen is still there the next time they sign in.
 *
 * Sending is best-effort: the action that triggered the notification has already
 * succeeded, so a failed write is logged and never fails the request. Reading and
 * clearing throw NotificationStoreError so routes can answer 500.
 */

import { supabase } from "./supabase-users";

const LIST_LIMIT = 100;
const TITLE_MAX = 160;
const BODY_MAX = 500;
const TYPE_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

export class NotificationStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[notifications] ${operation} failed`);
    this.name = "NotificationStoreError";
    console.error(`[notifications] ${operation} error:`, cause);
  }
}

export type NotificationInput = {
  type: string;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
};

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

/** Trim and bound the fields so a long username or message can't break the insert. */
export function normaliseNotification(input: NotificationInput): NotificationInput | null {
  const type = input.type.trim();
  const title = input.title.trim().slice(0, TITLE_MAX);
  if (!TYPE_PATTERN.test(type) || !title) return null;
  const body = input.body ? input.body.trim().slice(0, BODY_MAX) || null : null;
  return { type, title, body, payload: input.payload ?? {} };
}

/** Send one notification to each user. Best-effort: logs and returns on failure. */
export async function notifyUsers(userIds: string[], input: NotificationInput): Promise<void> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  const n = normaliseNotification(input);
  if (!n) {
    console.error("[notifications] rejected malformed notification:", input.type);
    return;
  }
  if (!supabase) {
    console.error("[notifications] Supabase is not configured; notification dropped:", n.type);
    return;
  }
  try {
    const rows = unique.map((user_id) => ({ user_id, type: n.type, title: n.title, body: n.body, payload: n.payload }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error(`[notifications] send ${n.type} error:`, error);
  } catch (err) {
    console.error(`[notifications] send ${n.type} failed:`, err);
  }
}

export async function notifyUser(userId: string, input: NotificationInput): Promise<void> {
  await notifyUsers([userId], input);
}

function requireClient() {
  if (!supabase) throw new NotificationStoreError("connect", "Supabase is not configured");
  return supabase;
}

/** The user's latest notifications, newest first. */
export async function listNotifications(userId: string): Promise<NotificationView[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("notifications")
    .select("id, type, title, body, payload, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new NotificationStoreError("list", error);
  return ((data ?? []) as {
    id: string;
    type: string;
    title: string;
    body: string | null;
    payload: Record<string, unknown> | null;
    read_at: string | null;
    created_at: string;
  }[]).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: r.payload ?? {},
    read: r.read_at != null,
    created_at: r.created_at,
  }));
}

/** Mark one notification read. Returns false when it isn't the user's. */
export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) throw new NotificationStoreError("mark read", error);
  return (data ?? []).length > 0;
}

/** Mark every unread notification read. Returns how many changed. */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const client = requireClient();
  const { data, error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) throw new NotificationStoreError("mark all read", error);
  return (data ?? []).length;
}

/** Delete all of the user's notifications ("empty notifications"). Returns how many. */
export async function clearNotifications(userId: string): Promise<number> {
  const client = requireClient();
  const { data, error } = await client.from("notifications").delete().eq("user_id", userId).select("id");
  if (error) throw new NotificationStoreError("clear", error);
  return (data ?? []).length;
}
