import type { PoolClient } from "pg";
import { Pool } from "pg";
import { supabase } from "./supabase-users";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let pgPool: Pool | null = null;
/** When true, direct DB is disabled for this process (e.g. "Tenant or user not found"); use RPC only. */
let directDbDisabled = false;

/** Rewrite Supabase direct host (db.REF.supabase.co) to pooler so DNS resolves. Use dashboard pooler URI as-is to avoid "Tenant or user not found". */
function toPoolerUrlIfNeeded(url: string): string {
  const match = url.match(/^(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@db\.([a-z0-9-]+)\.supabase\.co(?::(\d+))?(\/.*)?$/i);
  if (!match) return url;
  const [, scheme, user, password, ref, port, path] = match;
  const explicitHost = process.env.SUPABASE_POOLER_HOST?.trim();
  const poolerHost = explicitHost
    ? explicitHost.replace(/^https?:\/\//, "").split("/")[0]
    : `aws-0-${process.env.SUPABASE_POOLER_REGION || "us-east-1"}.pooler.supabase.com`;
  const poolerPort = port || "6543";
  const poolerUser = user === "postgres" ? `postgres.${ref}` : user;
  return `${scheme}${poolerUser}:${password}@${poolerHost}:${poolerPort}${path || "/postgres"}`;
}

function getPgPool(): Pool | null {
  if (directDbDisabled || pgPool) return pgPool ?? null;
  let url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!url.includes("pooler.supabase.com") && url.includes("db.") && url.includes(".supabase.co")) {
    url = toPoolerUrlIfNeeded(url);
  }
  try {
    pgPool = new Pool({
      connectionString: url,
      max: 2,
      ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    return pgPool;
  } catch {
    return null;
  }
}

export type WhisperMessage = {
  id: string;
  message: string;
  sent_by: string;
  sent_to: string;
  sent_by_id?: string;
  sent_to_id?: string;
  date: string;
  time: string;
  message_category: string;
  content_type?: string;
  bucket_ref?: string;
  view_once?: boolean;
  created_at?: string;
  sender_id?: string;
  reply_to_message_id?: string;
  reply_to_content?: string;
  reply_to_sender_id?: string;
  reply_to_sender_username?: string;
};

export type CallLogEntry = {
  id: string;
  call_type: "audio" | "video";
  duration_min_sec?: string;
  duration_seconds?: number;
  called_to: string;
  date: string;
  call_time: string;
  started_at?: string;
  ended_at?: string | null;
  status?: string;
  conversation_id?: string;
  other_user_id?: string;
};

const WHISPER_APPEND_RETRY_DELAYS_MS = [2000, 4000, 6000];

function runAppendWhisperViaPool(
  client: PoolClient,
  message: WhisperMessage,
  userId: string
): Promise<void> {
  return client
    .query("BEGIN")
    .then(() => client.query("SET LOCAL statement_timeout = '120s'"))
    .then(() =>
      client.query("SELECT append_user_whisper_message($1::jsonb, $2::uuid)", [
        message as unknown as Record<string, unknown>,
        userId,
      ])
    )
    .then(() => client.query("COMMIT"))
    .then((): void => {})
    .catch((e) => {
      return client.query("ROLLBACK").catch(() => {}).then(() => {
        throw e;
      });
    });
}

/** Atomic append: add message to user's whispers.messages. Uses direct pg with 120s timeout when DATABASE_URL set; else Supabase RPC. Retries on 57014 (direct and RPC). Falls back to RPC if pool fails. */
export async function appendWhisperMessage(userId: string, message: WhisperMessage): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    const maxAttempts = 1 + WHISPER_APPEND_RETRY_DELAYS_MS.length;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const client = await pool.connect();
        try {
          await runAppendWhisperViaPool(client, message, userId);
          return;
        } finally {
          client.release();
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "57014" && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, WHISPER_APPEND_RETRY_DELAYS_MS[attempt]));
          continue;
        }
        if (code === "57014") throw e;
        const msg = (e as Error).message || "";
        if (/tenant or user not found/i.test(msg)) {
          directDbDisabled = true;
          const p = pgPool;
          pgPool = null;
          p?.end().catch(() => {});
          console.warn("[Chat] Direct DB pooler auth failed (Tenant or user not found). Using Supabase RPC for this process. Fix: set DATABASE_URL to the Transaction/Session pooler URI from Project Settings > Database.");
        } else {
          console.warn("[Chat] Direct DB append failed, falling back to Supabase RPC:", msg);
        }
        break;
      }
    }
  }
  if (!supabase) throw new Error("Supabase not configured");
  const client = supabase;
  const run = async (): Promise<void> => {
    const { error } = await client.rpc("append_user_whisper_message", {
      p_message: message as unknown as Record<string, unknown>,
      p_user_id: userId,
    });
    if (error) throw error;
  };
  for (let attempt = 0; attempt <= WHISPER_APPEND_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await run();
      return;
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === "57014" && attempt < WHISPER_APPEND_RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, WHISPER_APPEND_RETRY_DELAYS_MS[attempt]));
      } else {
        throw e;
      }
    }
  }
}

/** Atomic append: add call log to user's whispers.call_logs. */
export async function appendCallLog(userId: string, log: CallLogEntry): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.rpc("append_user_call_log", {
    p_log: log as unknown as Record<string, unknown>,
    p_user_id: userId,
  });
  if (error) throw error;
}

/** Atomic append: add message to group's messages. Uses direct pg with 120s timeout when DATABASE_URL set; else Supabase RPC. Falls back to RPC if pool fails. */
export async function appendGroupMessage(groupId: string, message: WhisperMessage & { sent_to: string }): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '120s'");
        await client.query("SELECT append_group_message($1::jsonb, $2::uuid)", [
          message as unknown as Record<string, unknown>,
          groupId,
        ]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return;
    } catch (e) {
      if ((e as { code?: string }).code === "57014") throw e;
      console.warn("[Chat] Direct DB group append failed, falling back to Supabase RPC:", (e as Error).message);
    }
  }
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.rpc("append_group_message", {
    p_message: message as unknown as Record<string, unknown>,
    p_group_id: groupId,
  });
  if (error) throw error;
}

/** Get merged 1:1 thread: messages from both users' JSON (sent_to = other). Fetches both rows in parallel. */
export async function getWhisperThread(
  userId: string,
  otherUserId: string,
  limit = 100
): Promise<{ messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] }> {
  if (!supabase) return { messages: [], deleted_ids: [], view_once_consumed: [] };
  const since = Date.now() - THIRTY_DAYS_MS;
  const [resA, resB] = await Promise.all([
    supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle(),
    supabase.from("user_chat_data").select("data").eq("user_id", otherUserId).maybeSingle(),
  ]);
  const rowA = resA.data as { data?: { whispers?: { messages?: WhisperMessage[]; deleted_ids?: string[]; view_once_consumed?: string[] } } } | null;
  const rowB = resB.data as { data?: { whispers?: { messages?: WhisperMessage[] } } } | null;
  const dataA = rowA?.data;
  const dataB = rowB?.data;
  const messagesA = dataA?.whispers?.messages ?? [];
  const messagesB = dataB?.whispers?.messages ?? [];
  const deletedIds = new Set<string>(dataA?.whispers?.deleted_ids ?? []);
  const viewOnceConsumed = dataA?.whispers?.view_once_consumed ?? [];
  const fromA = messagesA.filter((m: WhisperMessage) => (m as { sent_to_id?: string }).sent_to_id === otherUserId);
  const fromB = messagesB.filter((m: WhisperMessage) => (m as { sent_to_id?: string }).sent_to_id === userId);
  const combined = [...fromA, ...fromB].filter((m) => {
    const ts = (m as { created_at?: string }).created_at;
    return !ts || new Date(ts).getTime() >= since;
  });
  combined.sort((a, b) => {
    const ta = (a as { created_at?: string }).created_at || a.date + " " + a.time;
    const tb = (b as { created_at?: string }).created_at || b.date + " " + b.time;
    return String(ta).localeCompare(String(tb));
  });
  const messages = combined.slice(-limit);
  return { messages, deleted_ids: Array.from(deletedIds), view_once_consumed: viewOnceConsumed };
}

/** Get whisper thread via DB RPC. Tries fast path (whisper_messages table) first; falls back to legacy RPC then getWhisperThread. */
export async function getWhisperThreadViaRpc(
  userId: string,
  otherUserId: string,
  limit = 50
): Promise<{ messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] }> {
  if (!supabase) return getWhisperThread(userId, otherUserId, limit);

  const parseRpcResult = (data: unknown): { messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] } => {
    const raw = data as { messages?: WhisperMessage[]; deleted_ids?: string[]; view_once_consumed?: string[] };
    return {
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      deleted_ids: Array.isArray(raw.deleted_ids) ? raw.deleted_ids : [],
      view_once_consumed: Array.isArray(raw.view_once_consumed) ? raw.view_once_consumed : [],
    };
  };

  try {
    const { data, error } = await supabase.rpc("get_whisper_thread_messages_fast", {
      p_user_id: userId,
      p_other_user_id: otherUserId,
      p_limit: limit,
    });
    if (!error && data != null) return parseRpcResult(data);
  } catch (e) {
    console.warn("[Chat] get_whisper_thread_messages_fast error:", (e as Error)?.message ?? e);
  }

  try {
    const { data, error } = await supabase.rpc("get_whisper_thread_messages", {
      p_user_id: userId,
      p_other_user_id: otherUserId,
      p_limit: limit,
    });
    if (!error && data != null) return parseRpcResult(data);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "57014" || err?.message?.includes("statement timeout")) {
      console.warn("[Chat] get_whisper_thread_messages timeout, falling back to getWhisperThread:", err.message);
    } else {
      console.warn("[Chat] get_whisper_thread_messages error:", err?.message ?? e);
    }
  }
  return getWhisperThread(userId, otherUserId, limit);
}

/** Count unread messages in a whisper thread. Uses RPC when available for speed; falls back to thread fetch. */
export async function getWhisperUnreadCount(userId: string, otherUserId: string): Promise<number> {
  if (supabase) {
    const { data, error } = await supabase.rpc("get_whisper_unread_count", {
      p_user_id: userId,
      p_other_user_id: otherUserId,
    });
    if (!error && typeof data === "number") return data;
  }
  const meta = await getConversationMeta(userId, otherUserId);
  const lastReadAt = meta?.last_read_at ?? null;
  const { messages } = await getWhisperThread(userId, otherUserId, 500);
  const fromOther = (m: WhisperMessage & { created_at?: string; sent_by_id?: string; sender_id?: string }) =>
    ((m.sent_by_id ?? m.sender_id) as string) === otherUserId;
  if (!lastReadAt) {
    return messages.filter(fromOther).length;
  }
  const t = new Date(lastReadAt).getTime();
  return messages.filter((m: WhisperMessage & { created_at?: string; sent_by_id?: string; sender_id?: string }) => fromOther(m) && new Date(m.created_at ?? 0).getTime() > t).length;
}

/** Get group messages (single group JSON). Fetches group and user data in parallel. */
export async function getGroupMessages(
  groupId: string,
  currentUserId: string,
  limit = 100
): Promise<{ messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] }> {
  if (!supabase) return { messages: [], deleted_ids: [], view_once_consumed: [] };
  const [groupRes, userRes] = await Promise.all([
    supabase.from("group_chat_data").select("data").eq("group_id", groupId).maybeSingle(),
    supabase.from("user_chat_data").select("data").eq("user_id", currentUserId).maybeSingle(),
  ]);
  const data = (groupRes.data as { data?: { messages?: WhisperMessage[] } })?.data;
  const all = data?.messages ?? [];
  const since = Date.now() - THIRTY_DAYS_MS;
  const filtered = all.filter((m: WhisperMessage & { created_at?: string }) => {
    const ts = m.created_at;
    return !ts || new Date(ts).getTime() >= since;
  });
  const messages = filtered.slice(-limit);
  const ud = (userRes.data as { data?: { whispers?: { deleted_ids?: string[]; view_once_consumed?: string[] } } })?.data;
  return {
    messages,
    deleted_ids: ud?.whispers?.deleted_ids ?? [],
    view_once_consumed: ud?.whispers?.view_once_consumed ?? [],
  };
}

const THIRTY_DAYS_ISO = () => new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

/** Fast path: read from normalized group_messages table (indexed). Tries direct pg first if DATABASE_URL set, else Supabase REST. */
async function getGroupMessagesFromTable(
  groupId: string,
  currentUserId: string,
  limit: number
): Promise<{ messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] } | null> {
  const since = THIRTY_DAYS_ISO();
  let messages: WhisperMessage[] = [];

  const pool = getPgPool();
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT message, created_at FROM group_messages WHERE group_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT $3`,
        [groupId, since, limit]
      );
      messages = (r.rows ?? []).map((row: { message: WhisperMessage }) => row.message).reverse();
    } catch (e) {
      console.warn("[Chat] group_messages direct pg read failed:", (e as Error).message);
      return null;
    }
  } else if (supabase) {
    const { data: rows, error } = await supabase
      .from("group_messages")
      .select("message,created_at")
      .eq("group_id", groupId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[Chat] group_messages table read failed:", error.message, error.code);
      return null;
    }
    messages = (rows ?? []).map((r: { message: WhisperMessage; created_at: string }) => r.message).reverse();
  } else {
    return null;
  }

  if (!supabase) return { messages, deleted_ids: [], view_once_consumed: [] };
  const { data: userRow } = await supabase.from("user_chat_data").select("data").eq("user_id", currentUserId).maybeSingle();
  const ud = userRow as { data?: { whispers?: { deleted_ids?: string[]; view_once_consumed?: string[] } } } | null;
  return {
    messages,
    deleted_ids: ud?.data?.whispers?.deleted_ids ?? [],
    view_once_consumed: ud?.data?.whispers?.view_once_consumed ?? [],
  };
}

/** Get group messages: table (fast) → RPC → full JSON fallback. Target < 500ms, max 2000ms. */
export async function getGroupMessagesViaRpc(
  groupId: string,
  currentUserId: string,
  limit = 100
): Promise<{ messages: WhisperMessage[]; deleted_ids: string[]; view_once_consumed: string[] }> {
  if (!supabase) return getGroupMessages(groupId, currentUserId, limit);
  const fromTable = await getGroupMessagesFromTable(groupId, currentUserId, limit);
  if (fromTable !== null) return fromTable;
  const { data, error } = await supabase.rpc("get_group_thread_messages", {
    p_group_id: groupId,
    p_user_id: currentUserId,
    p_limit: limit,
  });
  if (error || data == null) {
    if (error) console.warn("[Chat] get_group_thread_messages RPC error:", error.message, error.code);
    return getGroupMessages(groupId, currentUserId, limit);
  }
  const raw = data as { messages?: WhisperMessage[]; deleted_ids?: string[]; view_once_consumed?: string[] };
  return {
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    deleted_ids: Array.isArray(raw.deleted_ids) ? raw.deleted_ids : [],
    view_once_consumed: Array.isArray(raw.view_once_consumed) ? raw.view_once_consumed : [],
  };
}

/** Get last_read_at for a user in a group (from user_group_read). */
export async function getGroupLastRead(userId: string, groupId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("user_group_read").select("last_read_at").eq("user_id", userId).eq("group_id", groupId).maybeSingle();
  return (data as { last_read_at?: string } | null)?.last_read_at ?? null;
}

/** Mark group as read for user (upsert last_read_at). */
export async function setGroupRead(userId: string, groupId: string): Promise<void> {
  if (!supabase) return;
  const now = new Date().toISOString();
  await supabase.from("user_group_read").upsert(
    { user_id: userId, group_id: groupId, last_read_at: now, updated_at: now },
    { onConflict: "user_id,group_id" }
  );
}

/** Count unread messages in a group for user. Uses RPC when available (no full message fetch); else falls back to getGroupMessages. */
export async function getGroupUnreadCount(userId: string, groupId: string): Promise<number> {
  if (supabase) {
    const { data, error } = await supabase.rpc("get_group_unread_count", {
      p_user_id: userId,
      p_group_id: groupId,
    });
    if (!error && typeof data === "number") return data;
  }
  const lastReadAt = await getGroupLastRead(userId, groupId);
  const { messages } = await getGroupMessages(groupId, userId, 500);
  if (!lastReadAt) return messages.length;
  const t = new Date(lastReadAt).getTime();
  return messages.filter((m: WhisperMessage & { created_at?: string }) => new Date(m.created_at ?? 0).getTime() > t).length;
}

/** Get call logs for current user (whispers.call_logs). */
export async function getCallLogs(userId: string, conversationId?: string, limit = 50, offset = 0): Promise<CallLogEntry[]> {
  if (!supabase) return [];
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const logs = (row as { data?: { whispers?: { call_logs?: CallLogEntry[] } } })?.data?.whispers?.call_logs ?? [];
  let out = conversationId
    ? logs.filter((l: CallLogEntry & { conversation_id?: string; other_user_id?: string }) => l.conversation_id === conversationId || l.other_user_id === conversationId)
    : logs;
  out = out.slice(offset, offset + limit);
  return out;
}

/** Add to deleted_ids for "delete for me". */
export async function addDeletedForMe(userId: string, messageIds: string[]): Promise<void> {
  if (!supabase || messageIds.length === 0) return;
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const data = (row as { data?: Record<string, unknown> })?.data ?? {};
  const whispers = (data.whispers as Record<string, unknown>) ?? {};
  const deleted = (whispers.deleted_ids as string[]) ?? [];
  const next = [...new Set([...deleted, ...messageIds])];
  const nextData = {
    ...data,
    whispers: { ...whispers, deleted_ids: next },
  };
  await supabase.from("user_chat_data").upsert({ user_id: userId, data: nextData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/** Add to view_once_consumed. */
export async function addViewOnceConsumed(userId: string, messageId: string): Promise<void> {
  if (!supabase) return;
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const data = (row as { data?: Record<string, unknown> })?.data ?? {};
  const whispers = (data.whispers as Record<string, unknown>) ?? {};
  const consumed = (whispers.view_once_consumed as string[]) ?? [];
  if (consumed.includes(messageId)) return;
  const next = [...consumed, messageId];
  const nextData = { ...data, whispers: { ...whispers, view_once_consumed: next } };
  await supabase.from("user_chat_data").upsert({ user_id: userId, data: nextData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/** Delete for everyone / unsend (1:1): replace messages with tombstones so the other user sees "@username message deleted". */
export async function markWhisperMessagesAsDeletedForEveryone(userId: string, messageIds: string[]): Promise<void> {
  if (!supabase || messageIds.length === 0) return;
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const data = (row as { data?: { whispers?: { messages?: WhisperMessage[] } } })?.data;
  const messages = data?.whispers?.messages ?? [];
  const idSet = new Set(messageIds);
  const next = messages.map((m) => {
    if (!idSet.has(m.id)) return m;
    const base = m as WhisperMessage & { sent_to_id?: string; created_at?: string; date?: string; time?: string };
    return {
      ...base,
      message: "",
      content_type: "text",
      deleted_for_everyone: true,
      reply_to_message_id: undefined,
      reply_to_content: undefined,
      reply_to_sender_id: undefined,
      reply_to_sender_username: undefined,
    } as WhisperMessage & { deleted_for_everyone?: boolean };
  });
  const nextData = {
    ...data,
    whispers: { ...data?.whispers, messages: next },
  };
  await supabase.from("user_chat_data").upsert({ user_id: userId, data: nextData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/** Delete for everyone / unsend (group): replace messages with tombstones so members see "@username message deleted". */
export async function markGroupMessagesAsDeleted(groupId: string, messageIds: string[]): Promise<void> {
  if (!supabase || messageIds.length === 0) return;
  const { data: row } = await supabase.from("group_chat_data").select("data").eq("group_id", groupId).maybeSingle();
  const data = (row as { data?: { messages?: (WhisperMessage & { sent_to?: string })[] } })?.data;
  const messages = data?.messages ?? [];
  const idSet = new Set(messageIds);
  const next = messages.map((m) => {
    if (!idSet.has(m.id)) return m;
    const base = m as WhisperMessage & { sent_to?: string; created_at?: string; date?: string; time?: string };
    return {
      id: base.id,
      message: "",
      sent_by: base.sent_by ?? "",
      sent_to: base.sent_to ?? "",
      sent_by_id: (base as { sent_by_id?: string }).sent_by_id ?? (base as { sender_id?: string }).sender_id ?? "",
      date: base.date ?? "",
      time: base.time ?? "",
      message_category: (base as { message_category?: string }).message_category ?? "group",
      content_type: "text",
      created_at: base.created_at ?? "",
      deleted_for_everyone: true,
    };
  });
  await supabase
    .from("group_chat_data")
    .update({ data: { ...data, messages: next }, updated_at: new Date().toISOString() })
    .eq("group_id", groupId);
}

/** Remove call log ids from user's call_logs array. */
export async function removeCallLogs(userId: string, callLogIds: string[]): Promise<void> {
  if (!supabase || callLogIds.length === 0) return;
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const data = (row as { data?: { whispers?: { call_logs?: CallLogEntry[] } } })?.data;
  const logs = data?.whispers?.call_logs ?? [];
  const idSet = new Set(callLogIds);
  const next = logs.filter((l) => !idSet.has(l.id));
  const nextData = { ...data, whispers: { ...data?.whispers, call_logs: next } };
  await supabase.from("user_chat_data").upsert({ user_id: userId, data: nextData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

/** Build deterministic 1:1 conversation id (whisper_<smaller>_<larger>). */
export function whisperConversationId(userIdA: string, userIdB: string): string {
  const [a, b] = [userIdA, userIdB].sort();
  return `whisper_${a}_${b}`;
}

/** Parse conversation id: for whisper_ returns { type: 'whisper', otherUserId }; for UUID returns { type: 'group', groupId }. */
export function parseConversationId(conversationId: string, currentUserId: string): { type: "whisper"; otherUserId: string } | { type: "group"; groupId: string } | null {
  if (!conversationId) return null;
  if (conversationId.startsWith("whisper_")) {
    const parts = conversationId.split("_");
    if (parts.length !== 3) return null;
    // A whisper id names its two parties; anyone else gets null.
    if (parts[1] !== currentUserId && parts[2] !== currentUserId) return null;
    const other = parts[1] === currentUserId ? parts[2] : parts[1];
    return { type: "whisper", otherUserId: other };
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(conversationId)) return { type: "group", groupId: conversationId };
  return null;
}

/** Map backend WhisperMessage to frontend ChatMessage shape. */
export function toFrontendMessage(m: WhisperMessage & { deleted_for_everyone?: boolean }): {
  id: string;
  sender_id: string;
  content: string;
  content_type: string;
  created_at: string;
  reply_to_message_id?: string;
  reply_to_content?: string;
  reply_to_sender_id?: string;
  reply_to_sender_username?: string;
  sender_username?: string | null;
  deleted_for_everyone?: boolean;
} {
  const created = (m as { created_at?: string }).created_at || `${(m as { date?: string }).date || ""}T${(m as { time?: string }).time || ""}`;
  const deleted = !!(m as { deleted_for_everyone?: boolean }).deleted_for_everyone;
  const out: {
    id: string;
    sender_id: string;
    content: string;
    content_type: string;
    created_at: string;
    reply_to_message_id?: string;
    reply_to_content?: string;
    reply_to_sender_id?: string;
    reply_to_sender_username?: string;
    sender_username?: string | null;
    deleted_for_everyone?: boolean;
  } = {
    id: m.id,
    sender_id: (m as { sent_by_id?: string }).sent_by_id || (m as { sender_id?: string }).sender_id || (m as { sent_by?: string }).sent_by || "",
    content: deleted ? "" : (m.message || (m as { content?: string }).content || ""),
    content_type: m.content_type || "text",
    created_at: created,
    sender_username: (m as { sent_by?: string }).sent_by ?? null,
    ...(deleted ? { deleted_for_everyone: true } : {}),
  };
  if (m.reply_to_message_id && !deleted) out.reply_to_message_id = m.reply_to_message_id;
  if (m.reply_to_content != null && !deleted) out.reply_to_content = m.reply_to_content;
  if (m.reply_to_sender_id && !deleted) out.reply_to_sender_id = m.reply_to_sender_id;
  if (m.reply_to_sender_username && !deleted) out.reply_to_sender_username = m.reply_to_sender_username;
  return out;
}

/** Get unique partner user ids for 1:1 conversations. Uses RPC when available (fast); falls back to full scan. */
export async function listConversationPartnerIds(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data: ids, error } = await supabase.rpc("list_conversation_partner_ids", { p_user_id: userId });
  if (!error && Array.isArray(ids)) return ids as string[];
  if (ids != null && typeof ids === "object" && !Array.isArray(ids)) return [];
  const { data: myRow } = await supabase.from("user_chat_data").select("data").eq("user_id", userId).maybeSingle();
  const myData = (myRow as { data?: { whispers?: { messages?: WhisperMessage[] } } })?.data;
  const myMessages = myData?.whispers?.messages ?? [];
  const partners = new Set<string>();
  for (const m of myMessages) {
    const toId = (m as { sent_to_id?: string }).sent_to_id;
    if (toId && toId !== userId) partners.add(toId);
  }
  const { data: allRows } = await supabase.from("user_chat_data").select("user_id, data");
  for (const row of allRows ?? []) {
    const r = row as { user_id: string; data?: { whispers?: { messages?: WhisperMessage[] } } };
    if (r.user_id === userId) continue;
    const messages = r.data?.whispers?.messages ?? [];
    for (const m of messages) {
      const toId = (m as { sent_to_id?: string }).sent_to_id;
      if (toId === userId) {
        const byId = (m as { sent_by_id?: string }).sent_by_id || (m as { sender_id?: string }).sender_id;
        if (byId) partners.add(byId);
      }
    }
  }
  return Array.from(partners);
}

export type GroupRow = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  motive?: string | null;
  view_only_mode?: boolean;
  priority_user_id?: string | null;
  avatar_url?: string | null;
};
export type GroupMemberRow = { group_id: string; user_id: string; role: string; joined_at: string };

/** List groups the user is a member of. */
export async function listGroupsForUser(userId: string): Promise<GroupRow[]> {
  if (!supabase) return [];
  const { data: members } = await supabase.from("group_members").select("group_id").eq("user_id", userId);
  if (!members?.length) return [];
  const ids = (members as { group_id: string }[]).map((m) => m.group_id);
  const { data: groups } = await supabase
    .from("groups")
    .select("id, name, created_by, created_at, updated_at, motive, view_only_mode, priority_user_id, avatar_url")
    .in("id", ids);
  return (groups as GroupRow[]) ?? [];
}

/** Get group by id. */
export async function getGroupById(groupId: string): Promise<GroupRow | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("groups")
    .select("id, name, created_by, created_at, updated_at, motive, view_only_mode, priority_user_id, avatar_url")
    .eq("id", groupId)
    .maybeSingle();
  return data as GroupRow | null;
}

/** Get group members with user info (id, username, avatar_url from users). */
export async function getGroupMembersWithUsers(groupId: string): Promise<{ user_id: string; role: string; joined_at: string; username?: string | null; avatar_url?: string | null }[]> {
  if (!supabase) return [];
  const { data: rows } = await supabase.from("group_members").select("user_id, role, joined_at").eq("group_id", groupId);
  if (!rows?.length) return [];
  const userIds = (rows as { user_id: string }[]).map((r) => r.user_id);
  const { data: users } = await supabase.from("users").select("id, username, avatar_url").in("id", userIds);
  const userMap = new Map((users ?? []).map((u: { id: string; username?: string | null; avatar_url?: string | null }) => [u.id, u]));
  return (rows as { user_id: string; role: string; joined_at: string }[]).map((r) => ({
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    username: (userMap.get(r.user_id) as { username?: string | null })?.username ?? null,
    avatar_url: (userMap.get(r.user_id) as { avatar_url?: string | null })?.avatar_url ?? null,
  }));
}

/** Create group and add creator as member with role creator. */
export async function createGroup(name: string, createdBy: string): Promise<{ id: string } | null> {
  if (!supabase) return null;
  const { data: group, error: gErr } = await supabase.from("groups").insert({ name: name.trim(), created_by: createdBy }).select("id").single();
  if (gErr || !group) return null;
  await supabase.from("group_members").insert({ group_id: (group as { id: string }).id, user_id: createdBy, role: "creator" });
  await supabase.from("group_chat_data").insert({ group_id: (group as { id: string }).id, data: { v: 1, messages: [], meta: {} } });
  return { id: (group as { id: string }).id };
}

/** Update group (name, motive, view_only_mode, priority_user_id, avatar_url). */
export async function updateGroup(
  groupId: string,
  payload: {
    name?: string;
    motive?: string | null;
    view_only_mode?: boolean;
    priority_user_id?: string | null;
    avatar_url?: string | null;
  }
): Promise<boolean> {
  if (!supabase) return false;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.motive !== undefined) updates.motive = payload.motive;
  if (payload.view_only_mode !== undefined) updates.view_only_mode = payload.view_only_mode;
  if (payload.priority_user_id !== undefined) updates.priority_user_id = payload.priority_user_id;
  if (payload.avatar_url !== undefined) updates.avatar_url = payload.avatar_url;
  const { error } = await supabase.from("groups").update(updates).eq("id", groupId);
  return !error;
}

/** Delete group (cascade deletes group_members and group_chat_data). */
export async function deleteGroup(groupId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("groups").delete().eq("id", groupId);
  return !error;
}

/** Remove member from group. */
export async function removeGroupMember(groupId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  return !error;
}

/** Set member role. */
export async function setGroupMemberRole(groupId: string, userId: string, role: "admin" | "member"): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", userId);
  return !error;
}

/** Check if user is member of group. */
export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  return !!data;
}

/** Get conversation meta (favorite, last_read) for 1:1. */
export async function getConversationMeta(userId: string, otherUserId: string): Promise<{ is_favorite: boolean; last_read_at: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("user_conversation_meta").select("is_favorite, last_read_at").eq("user_id", userId).eq("other_user_id", otherUserId).maybeSingle();
  return data as { is_favorite: boolean; last_read_at: string | null } | null;
}

/** Batch get conversation meta for multiple other_user_ids. Returns Map keyed by other_user_id. */
export async function getConversationMetaBatch(
  userId: string,
  otherUserIds: string[]
): Promise<Map<string, { is_favorite: boolean; last_read_at: string | null }>> {
  const map = new Map<string, { is_favorite: boolean; last_read_at: string | null }>();
  if (!supabase || otherUserIds.length === 0) return map;
  const ids = [...new Set(otherUserIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("user_conversation_meta")
    .select("other_user_id, is_favorite, last_read_at")
    .eq("user_id", userId)
    .in("other_user_id", ids);
  (data ?? []).forEach((row: { other_user_id: string; is_favorite: boolean; last_read_at: string | null }) => {
    map.set(row.other_user_id, { is_favorite: row.is_favorite, last_read_at: row.last_read_at });
  });
  return map;
}

/** Set favorite for 1:1. */
export async function setConversationFavorite(userId: string, otherUserId: string, isFavorite: boolean): Promise<void> {
  if (!supabase) return;
  await supabase.from("user_conversation_meta").upsert(
    { user_id: userId, other_user_id: otherUserId, is_favorite: isFavorite, updated_at: new Date().toISOString() },
    { onConflict: "user_id,other_user_id" }
  );
}

/** Mark conversation read (last_read_at). */
export async function setConversationRead(userId: string, otherUserId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("user_conversation_meta").upsert(
    { user_id: userId, other_user_id: otherUserId, last_read_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "user_id,other_user_id" }
  );
}

/** List user ids that are connected to the given user (from connections table). */
export async function listConnectionUserIds(userId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data: rows } = await supabase.from("connections").select("user_id, connected_user_id");
  if (!rows?.length) return [];
  const ids = new Set<string>();
  for (const r of rows as { user_id: string; connected_user_id: string }[]) {
    if (r.user_id === userId) ids.add(r.connected_user_id);
    else if (r.connected_user_id === userId) ids.add(r.user_id);
  }
  return Array.from(ids);
}

export type GroupInviteRow = {
  id: string;
  group_id: string;
  invited_by: string;
  invited_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Get invites for a group (for admins). */
export async function getGroupInvites(groupId: string): Promise<GroupInviteRow[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("group_invites").select("*").eq("group_id", groupId).order("created_at", { ascending: false });
  return (data as GroupInviteRow[]) ?? [];
}

/** Create a group invite (admin only). Fails if already invited or already member. */
export async function createGroupInvite(groupId: string, invitedBy: string, invitedUserId: string): Promise<{ invite_id: string } | { error: string }> {
  if (!supabase) return { error: "Not configured" };
  const isMember = await isGroupMember(groupId, invitedUserId);
  if (isMember) return { error: "User is already a member" };
  const { data: existing } = await supabase
    .from("group_invites")
    .select("id, status")
    .eq("group_id", groupId)
    .eq("invited_user_id", invitedUserId)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; status: string };
    if (row.status === "pending") return { error: "Invite already sent" };
    if (row.status === "accepted") return { error: "Already joined" };
    if (row.status === "rejected") {
      const { error: updateErr } = await supabase
        .from("group_invites")
        .update({ status: "pending", invited_by: invitedBy, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateErr) return { error: updateErr.message };
      return { invite_id: row.id };
    }
  }
  const { data: inserted, error } = await supabase
    .from("group_invites")
    .insert({
      group_id: groupId,
      invited_by: invitedBy,
      invited_user_id: invitedUserId,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { invite_id: (inserted as { id: string }).id };
}

/** Get pending invites for a user (invites sent to them). */
export async function getPendingInvitesForUser(userId: string): Promise<GroupInviteRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("group_invites")
    .select("*")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data as GroupInviteRow[]) ?? [];
}

/** Accept a group invite: set status to accepted and add user as member. */
export async function acceptGroupInvite(inviteId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: invite } = await supabase.from("group_invites").select("*").eq("id", inviteId).eq("invited_user_id", userId).eq("status", "pending").maybeSingle();
  if (!invite) return false;
  const row = invite as { group_id: string };
  const { error: updateErr } = await supabase
    .from("group_invites")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (updateErr) return false;
  await supabase.from("group_members").insert({ group_id: row.group_id, user_id: userId, role: "member" });
  const { data: g } = await supabase.from("group_chat_data").select("group_id").eq("group_id", row.group_id).maybeSingle();
  if (!g) await supabase.from("group_chat_data").insert({ group_id: row.group_id, data: { v: 1, messages: [], meta: {} }, updated_at: new Date().toISOString() });
  return true;
}

/** Reject a group invite. */
export async function rejectGroupInvite(inviteId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("group_invites")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("invited_user_id", userId)
    .eq("status", "pending");
  return !error;
}
