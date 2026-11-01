/**
 * Best-effort notifications from the chat service (messages, calls, group invites,
 * breakout moves). The triggering action has already succeeded, so failures are logged
 * and never thrown. Same notifications table as the auth service.
 */

import { supabase } from "./supabase-users";

/** A burst of messages from one sender updates one unread notification for this long. */
const MESSAGE_GROUP_WINDOW_MS = 10 * 60 * 1000;
const PREVIEW_MAX = 140;

type Input = { type: string; title: string; body?: string | null; payload?: Record<string, unknown> };

/** Insert one notification per user. */
export async function notifyUsers(userIds: string[], input: Input): Promise<void> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0 || !supabase) return;
  try {
    const rows = ids.map((user_id) => ({
      user_id,
      type: input.type,
      title: input.title.slice(0, 160),
      body: input.body ? input.body.slice(0, 500) : null,
      payload: input.payload ?? {},
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error(`[notify] ${input.type} error:`, error);
  } catch (err) {
    console.error(`[notify] ${input.type} failed:`, err);
  }
}

/** Shorten a message for a notification preview. */
export function messagePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/**
 * Notify about a new message. If the recipient already has an unread message
 * notification for this conversation from the last few minutes, refresh it instead
 * of adding another, so a fast conversation does not flood the list.
 */
export async function notifyMessage(
  recipientIds: string[],
  args: { conversationId: string; senderId: string; title: string; text: string }
): Promise<void> {
  if (!supabase) return;
  const since = new Date(Date.now() - MESSAGE_GROUP_WINDOW_MS).toISOString();
  const body = messagePreview(args.text);
  for (const recipientId of new Set(recipientIds)) {
    if (!recipientId || recipientId === args.senderId) continue;
    try {
      const { data: existing, error: findError } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", recipientId)
        .eq("type", "message")
        .is("read_at", null)
        .gte("created_at", since)
        .contains("payload", { conversation_id: args.conversationId })
        .limit(1)
        .maybeSingle();
      if (findError) {
        console.error("[notify] message lookup error:", findError);
        continue;
      }
      if (existing) {
        const { error } = await supabase
          .from("notifications")
          .update({ title: args.title, body, created_at: new Date().toISOString() })
          .eq("id", (existing as { id: string }).id);
        if (error) console.error("[notify] message refresh error:", error);
      } else {
        await notifyUsers([recipientId], {
          type: "message",
          title: args.title,
          body,
          payload: { conversation_id: args.conversationId, from_user_id: args.senderId },
        });
      }
    } catch (err) {
      console.error("[notify] message failed:", err);
    }
  }
}

/** Mark the user's unread message notifications for one conversation as read. Best-effort. */
export async function markMessageNotificationsRead(userId: string, conversationId: string): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("type", "message")
      .eq("payload->>conversation_id", conversationId)
      .is("read_at", null);
    if (error) console.error("[notify] mark message notifications read error:", error);
  } catch (err) {
    console.error("[notify] mark message notifications read failed:", err);
  }
}
