import path from "path";
import http from "http";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { requireAuth, type CurrentUser } from "./auth";
import { attachSocketIo, broadcastMessageReceived, broadcastMessageDeleted, emitToUser, getOnlineUserIds } from "./ws";
import { getUserById, getUsersByIds, supabase } from "./supabase-users";
import { notifyMessage, notifyUsers } from "./notify";
import {
  whisperConversationId,
  parseConversationId,
  listConversationPartnerIds,
  getWhisperThread,
  getWhisperThreadViaRpc,
  getGroupMessages,
  getGroupMessagesViaRpc,
  toFrontendMessage,
  appendWhisperMessage,
  appendGroupMessage,
  addDeletedForMe,
  markWhisperMessagesAsDeletedForEveryone,
  markGroupMessagesAsDeleted,
  removeCallLogs,
  getCallLogs,
  appendCallLog,
  listGroupsForUser,
  getGroupById,
  getGroupMembersWithUsers,
  createGroup,
  updateGroup,
  deleteGroup,
  removeGroupMember,
  setGroupMemberRole,
  isGroupMember,
  getConversationMeta,
  getConversationMetaBatch,
  setConversationFavorite,
  setConversationRead,
  getWhisperUnreadCount,
  setGroupRead,
  getGroupUnreadCount,
  listConnectionUserIds,
  getGroupInvites,
  createGroupInvite,
  getPendingInvitesForUser,
  acceptGroupInvite,
  rejectGroupInvite,
  type WhisperMessage,
  type CallLogEntry,
} from "./db";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(null, !!ok);
  },
});

const chatLog = (section: "Whispers" | "Group" | "Archive", action: string, detail: string) => {
  console.log(`[Chat] [${section}] ${action} – ${detail}`);
};

const app = express();
const PORT = Number(process.env.CHAT_SERVICE_PORT || process.env.PORT || 4002);

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get("/health", (_req, res) => {
  res.json({ service: "chat-service", ok: true });
});

// ---------- Dev: test RPCs (conversation list perf) ----------
if (process.env.NODE_ENV === "development" && supabase) {
  const supabaseClient = supabase;
  app.get("/api/dev/test-rpcs", async (_req, res) => {
    try {
      const { data: users } = await supabaseClient.from("users").select("id").limit(1);
      const userId = (users?.[0] as { id: string } | undefined)?.id;
      if (!userId) {
        return res.status(404).json({ ok: false, message: "No user in DB" });
      }
      const t0 = Date.now();
      const partnerIds = await listConversationPartnerIds(userId);
      const t1 = Date.now();
      const unreadCount = partnerIds.length > 0
        ? await getWhisperUnreadCount(userId, partnerIds[0])
        : 0;
      const t2 = Date.now();
      res.json({
        ok: true,
        user_id: userId,
        list_conversation_partner_ids: partnerIds,
        list_partners_ms: t1 - t0,
        get_whisper_unread_count: partnerIds.length > 0 ? unreadCount : null,
        unread_count_ms: t2 - t1,
        total_ms: t2 - t0,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });
}

// ---------- Conversations ----------
app.get("/api/conversations/me", requireAuth, (_req, res) => {
  res.json({ id: "__self__", name: "You" });
});

app.get("/api/conversations", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const userId = user.userId;
  try {
    const partnerIds = await listConversationPartnerIds(userId);
    const [onlineIds, usersMap, metaMap] = await Promise.all([
      Promise.resolve(getOnlineUserIds()),
      partnerIds.length ? getUsersByIds(partnerIds) : Promise.resolve(new Map()),
      partnerIds.length ? getConversationMetaBatch(userId, partnerIds) : Promise.resolve(new Map()),
    ]);
    const list = await Promise.all(
      partnerIds.map(async (otherId) => {
        const otherUser = usersMap.get(otherId);
        const meta = metaMap.get(otherId);
        const unreadCount = await getWhisperUnreadCount(userId, otherId);
        const convId = whisperConversationId(userId, otherId);
        return {
          id: convId,
          name: (otherUser?.username as string) || "User",
          avatar_url: (otherUser as { avatar_url?: string | null })?.avatar_url ?? null,
          lastMessage: null,
          lastSeenAt: null,
          isFavorite: meta?.is_favorite ?? false,
          unreadCount,
          isOnline: onlineIds.includes(otherId),
          otherUserId: otherId,
        };
      })
    );
    chatLog("Whispers", "Conversation list retrieved", `partners=${partnerIds.length}`);
    res.json(list);
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});

app.post("/api/conversations", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const otherUserId = (req.body?.other_user_id as string)?.trim();
  if (!otherUserId) {
    res.status(400).json({ message: "other_user_id required" });
    return;
  }
  const otherUser = await getUserById(otherUserId);
  const convId = whisperConversationId(user.userId, otherUserId);
  res.json({
    id: convId,
    name: (otherUser?.username as string) || "User",
    avatar_url: (otherUser as { avatar_url?: string | null })?.avatar_url ?? null,
    other_user_id: otherUserId,
  });
});

app.patch("/api/conversations/:id/favorite", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const parsed = parseConversationId(req.params.id, user.userId);
  if (!parsed || parsed.type !== "whisper") {
    res.status(400).json({ message: "Invalid conversation" });
    return;
  }
  const isFavorite = !!req.body?.is_favorite;
  await setConversationFavorite(user.userId, parsed.otherUserId, isFavorite);
  res.json({ ok: true });
});

app.patch("/api/conversations/:id/read", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const parsed = parseConversationId(req.params.id, user.userId);
  if (!parsed) {
    res.status(400).json({ message: "Invalid conversation" });
    return;
  }
  if (parsed.type === "whisper") {
    await setConversationRead(user.userId, parsed.otherUserId);
  } else {
    await setGroupRead(user.userId, parsed.groupId);
  }
  res.json({ ok: true });
});

// ---------- Messages ----------
app.get("/api/conversations/:id/messages", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const convId = req.params.id;
  const parsed = parseConversationId(convId, user.userId);
  if (!parsed) {
    res.status(400).json({ message: "Invalid conversation id" });
    return;
  }
  try {
    if (parsed.type === "whisper") {
      const { messages, deleted_ids, view_once_consumed } = await getWhisperThreadViaRpc(user.userId, parsed.otherUserId, 50);
      const out = messages.map(toFrontendMessage);
      chatLog("Whispers", "Messages retrieved", `conv=${convId} count=${out.length}`);
      res.json({
        messages: out,
        deleted_ids: deleted_ids ?? [],
        view_once_consumed: view_once_consumed ?? [],
      });
    } else {
      const { messages, deleted_ids, view_once_consumed } = await getGroupMessagesViaRpc(parsed.groupId, user.userId);
      const out = messages.map(toFrontendMessage) as { id: string; sender_id: string; content: string; content_type: string; created_at: string; sender_username?: string }[];
      const senderIds = [...new Set(out.map((m) => m.sender_id).filter(Boolean))];
      const usersMap = await getUsersByIds(senderIds);
      out.forEach((m) => {
        (m as { sender_username?: string | null }).sender_username = (usersMap.get(m.sender_id)?.username as string) ?? null;
      });
      chatLog("Group", "Messages retrieved", `group=${parsed.groupId} count=${out.length}`);
      res.json({
        messages: out,
        deleted_ids: deleted_ids ?? [],
        view_once_consumed: view_once_consumed ?? [],
      });
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const isTimeout = err?.code === "57014" || err?.message?.includes("statement timeout") || err?.message?.includes("canceling statement");
    if (isTimeout) {
      console.warn("[Chat] GET messages timeout (conv=" + convId + "):", err.message);
    } else {
      console.error("[Chat] GET messages error:", err?.message ?? e);
    }
    if (!res.headersSent) {
      res.status(isTimeout ? 503 : 500).json({
        message: isTimeout ? "Messages temporarily unavailable (timeout). Please try again." : (err?.message ?? "Failed to load messages"),
      });
    }
  }
});

app.post("/api/conversations/:id/messages", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const convId = req.params.id;
  if (convId === "__self__") {
    res.status(400).json({ message: "Cannot send messages to yourself" });
    return;
  }
  const content = (req.body?.content as string) ?? "";
  const contentType = (req.body?.content_type as string) || "text";
  const bucketRef = req.body?.bucket_ref as string | undefined;
  const replyToMessageId = (req.body?.reply_to_message_id as string) || undefined;
  const replyToContent = (req.body?.reply_to_content as string) || undefined;
  const replyToSenderId = (req.body?.reply_to_sender_id as string) || undefined;
  const replyToSenderUsername = (req.body?.reply_to_sender_username as string) || undefined;
  const parsed = parseConversationId(convId, user.userId);
  if (!parsed) {
    res.status(400).json({ message: "Invalid conversation id" });
    return;
  }
  const replyToFields = replyToMessageId
    ? {
        reply_to_message_id: replyToMessageId,
        reply_to_content: replyToContent ?? "",
        reply_to_sender_id: replyToSenderId ?? "",
        reply_to_sender_username: replyToSenderUsername ?? "",
      }
    : {};
  const id = crypto.randomUUID();
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  let front: ReturnType<typeof toFrontendMessage>;
  if (parsed.type === "whisper") {
    const otherUser = await getUserById(parsed.otherUserId);
    const msg: WhisperMessage = {
      id,
      message: content,
      sent_by: user.username ?? "",
      sent_to: (otherUser?.username as string) ?? "",
      sent_by_id: user.userId,
      sent_to_id: parsed.otherUserId,
      date,
      time,
      message_category: "whispers",
      content_type: contentType,
      bucket_ref: bucketRef,
      created_at: now.toISOString(),
      ...replyToFields,
    };
    front = toFrontendMessage(msg);
    const whisperPayload: import("./ws").MessageReceivedPayload = {
      id: front.id,
      conversation_id: convId,
      sender_id: front.sender_id,
      content: front.content,
      content_type: front.content_type,
      created_at: front.created_at,
    };
    if ((front as { sender_username?: string | null }).sender_username != null) {
      whisperPayload.sender_username = (front as { sender_username?: string | null }).sender_username;
    }
    if (front.reply_to_message_id) {
      whisperPayload.reply_to_message_id = front.reply_to_message_id;
      whisperPayload.reply_to_content = front.reply_to_content;
      whisperPayload.reply_to_sender_id = front.reply_to_sender_id;
      whisperPayload.reply_to_sender_username = front.reply_to_sender_username;
    }
    emitToUser(parsed.otherUserId, "message:received", whisperPayload);
    broadcastMessageReceived(convId, whisperPayload);
    void notifyMessage([parsed.otherUserId], {
      conversationId: convId,
      senderId: user.userId,
      title: `${user.username ? `@${user.username}` : "New message"} sent you a message`,
      text: String(content),
    });
    try {
      await appendWhisperMessage(user.userId, msg);
      chatLog("Whispers", "Message stored successfully", `id=${id} from=${user.userId} to=${parsed.otherUserId}`);
      res.status(201).json(front);
    } catch (e) {
      broadcastMessageDeleted(convId, [id]);
      const errMsg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
      const isHtml = errMsg.trimStart().startsWith("<!DOCTYPE") || errMsg.includes("</html>");
      console.error("[Chat] Whisper append failed (sender=" + user.userId + "):", isHtml ? "API/connection error (e.g. 520)" : e);
      if (!res.headersSent) res.status(500).json({ message: "Failed to save message" });
    }
    return;
  } else {
    const isMember = await isGroupMember(parsed.groupId, user.userId);
    if (!isMember) {
      res.status(403).json({ message: "Not a group member" });
      return;
    }
    const msg: WhisperMessage & { sent_to: string } = {
      id,
      message: content,
      sent_by: user.username ?? "",
      sent_to: parsed.groupId,
      sent_by_id: user.userId,
      sent_to_id: parsed.groupId,
      date,
      time,
      message_category: "group",
      content_type: contentType,
      bucket_ref: bucketRef,
      created_at: now.toISOString(),
      ...replyToFields,
    };
    front = toFrontendMessage(msg);
    (front as { sender_username?: string | null }).sender_username = user.username ?? undefined;
    const payload: import("./ws").MessageReceivedPayload = {
      id: front.id,
      conversation_id: convId,
      sender_id: front.sender_id,
      content: front.content,
      content_type: front.content_type,
      created_at: front.created_at,
    };
    if ((front as { sender_username?: string | null }).sender_username != null) {
      payload.sender_username = (front as { sender_username?: string | null }).sender_username;
    }
    if (front.reply_to_message_id) {
      payload.reply_to_message_id = front.reply_to_message_id;
      payload.reply_to_content = front.reply_to_content;
      payload.reply_to_sender_id = front.reply_to_sender_id;
      payload.reply_to_sender_username = front.reply_to_sender_username;
    }
    broadcastMessageReceived(convId, payload);
    void getGroupMembersWithUsers(parsed.groupId)
      .then(async (members) => {
        const group = await getGroupById(parsed.groupId);
        await notifyMessage(
          members.map((m) => m.user_id),
          {
            conversationId: convId,
            senderId: user.userId,
            title: `${user.username ? `@${user.username}` : "Someone"} in ${(group as { name?: string } | null)?.name ?? "a group"}`,
            text: String(content),
          }
        );
      })
      .catch((err) => console.error("[notify] group message failed:", err));
    try {
      await appendGroupMessage(parsed.groupId, msg);
      chatLog("Group", "Message stored successfully", `id=${id} group=${parsed.groupId} from=${user.userId}`);
      res.status(201).json(front);
    } catch (e) {
      broadcastMessageDeleted(convId, [id]);
      console.error("[Chat] Group append failed (group=" + parsed.groupId + "):", e);
      if (!res.headersSent) res.status(500).json({ message: "Failed to save message" });
    }
    return;
  }
});

app.post("/api/conversations/:id/messages/delete-for-me", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const messageIds = Array.isArray(req.body?.message_ids) ? (req.body.message_ids as string[]) : [];
  if (!messageIds.length) {
    res.status(400).json({ message: "message_ids required" });
    return;
  }
  await addDeletedForMe(user.userId, messageIds);
  chatLog("Whispers", "Delete for me", `user=${user.userId} ids=${messageIds.join(",")}`);
  res.json({ ok: true });
});

app.post("/api/conversations/:id/messages/delete-for-everyone", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const convId = req.params.id;
  const messageIds = Array.isArray(req.body?.message_ids) ? (req.body.message_ids as string[]) : [];
  if (!messageIds.length) {
    res.status(400).json({ message: "message_ids required" });
    return;
  }
  const parsed = parseConversationId(convId, user.userId);
  if (!parsed) {
    res.status(400).json({ message: "Invalid conversation" });
    return;
  }
  if (parsed.type === "whisper") {
    await markWhisperMessagesAsDeletedForEveryone(user.userId, messageIds);
  } else {
    await markGroupMessagesAsDeleted(parsed.groupId, messageIds);
  }
  broadcastMessageDeleted(convId, messageIds);
  chatLog(parsed.type === "whisper" ? "Whispers" : "Group", "Deleted for everyone", `conv=${convId} ids=${messageIds.join(",")}`);
  res.json({ deleted: messageIds });
});

app.post("/api/conversations/:id/messages/unsend", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const convId = req.params.id;
  const messageIds = Array.isArray(req.body?.message_ids) ? (req.body.message_ids as string[]) : [];
  if (!messageIds.length) {
    res.status(400).json({ message: "message_ids required" });
    return;
  }
  const parsed = parseConversationId(convId, user.userId);
  if (!parsed) {
    res.status(400).json({ message: "Invalid conversation" });
    return;
  }
  if (parsed.type === "whisper") {
    await markWhisperMessagesAsDeletedForEveryone(user.userId, messageIds);
  } else {
    await markGroupMessagesAsDeleted(parsed.groupId, messageIds);
  }
  broadcastMessageDeleted(convId, messageIds);
  chatLog(parsed.type === "whisper" ? "Whispers" : "Group", "Unsent", `conv=${convId} ids=${messageIds.join(",")}`);
  res.json({ unsent: messageIds });
});

// ---------- Groups ----------
app.get("/api/groups", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groups = await listGroupsForUser(user.userId);
  const list = await Promise.all(
    groups.map(async (g) => {
      const unreadCount = await getGroupUnreadCount(user.userId, g.id);
      return {
        id: g.id,
        conversation_id: g.id,
        name: g.name,
        avatar_url: (g as { avatar_url?: string | null }).avatar_url ?? null,
        unreadCount,
        isFavorite: false,
        lastMessage: null,
        lastMessageAt: null,
        lastMessageSenderUsername: null,
      };
    })
  );
  chatLog("Group", "Group list retrieved", `user=${user.userId} count=${list.length}`);
  res.json(list);
});

app.post("/api/groups", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const name = (req.body?.name as string)?.trim();
  if (!name) {
    res.status(400).json({ message: "name required" });
    return;
  }
  const created = await createGroup(name, user.userId);
  if (!created) {
    res.status(500).json({ message: "Failed to create group" });
    return;
  }
  chatLog("Group", "Group created", `id=${created.id} name=${name} by=${user.userId}`);
  res.status(201).json({ id: created.id, conversation_id: created.id });
});

// Group invites (must be before /api/groups/:id so "invites" is not captured as id)
app.get("/api/groups/invites/pending", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const invites = await getPendingInvitesForUser(user.userId);
  const out = await Promise.all(
    invites.map(async (inv) => {
      const inviter = await getUserById(inv.invited_by);
      const group = await getGroupById(inv.group_id);
      return {
        id: inv.id,
        group_id: inv.group_id,
        invited_by: inv.invited_by,
        invited_user_id: inv.invited_user_id,
        status: inv.status,
        created_at: inv.created_at,
        updated_at: inv.updated_at,
        group_name: (group?.name as string) ?? undefined,
        inviter_username: (inviter?.username as string) ?? null,
        invitee_username: null,
      };
    })
  );
  res.json(out);
});

app.post("/api/groups/invites/:id/accept", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const inviteId = req.params.id;
  const ok = await acceptGroupInvite(inviteId, user.userId);
  if (!ok) {
    res.status(400).json({ message: "Invite not found or already used" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/groups/invites/:id/reject", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const inviteId = req.params.id;
  const ok = await rejectGroupInvite(inviteId, user.userId);
  if (!ok) {
    res.status(400).json({ message: "Invite not found or already used" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/groups/:id", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const group = await getGroupById(groupId);
  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }
  const isMember = await isGroupMember(groupId, user.userId);
  if (!isMember) {
    res.status(403).json({ message: "Not a member" });
    return;
  }
  const members = await getGroupMembersWithUsers(groupId);
  const onlineIds = getOnlineUserIds();
  res.json({
    id: group.id,
    conversation_id: group.id,
    name: group.name,
    avatar_url: (group as { avatar_url?: string | null }).avatar_url ?? null,
    motive: (group as { motive?: string | null }).motive ?? null,
    view_only_mode: (group as { view_only_mode?: boolean }).view_only_mode ?? false,
    priority_user_id: (group as { priority_user_id?: string | null }).priority_user_id ?? null,
    created_by: group.created_by,
    created_at: group.created_at,
    updated_at: group.updated_at,
    members: members.map((m) => ({ user_id: m.user_id, username: m.username, avatar_url: m.avatar_url, display_name: m.username, role: m.role, joined_at: m.joined_at, is_online: onlineIds.includes(m.user_id) })),
  });
});

app.patch("/api/groups/:id", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const group = await getGroupById(groupId);
  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }
  const isMember = await isGroupMember(groupId, user.userId);
  if (!isMember) {
    res.status(403).json({ message: "Not a member" });
    return;
  }
  const members = await getGroupMembersWithUsers(groupId);
  const myRole = members.find((m) => m.user_id === user.userId)?.role;
  const isAdmin = myRole === "creator" || myRole === "admin";
  const payload: { name?: string; motive?: string; view_only_mode?: boolean; priority_user_id?: string | null; avatar_url?: string | null } = {};
  const name = (req.body?.name as string)?.trim();
  if (name !== undefined) payload.name = name;
  if (isAdmin) {
    if (req.body?.motive !== undefined) payload.motive = (req.body.motive as string)?.trim() || undefined;
    if (typeof req.body?.view_only_mode === "boolean") payload.view_only_mode = req.body.view_only_mode;
    if (req.body?.priority_user_id !== undefined) payload.priority_user_id = (req.body.priority_user_id as string) || null;
    if (req.body?.avatar_url !== undefined) payload.avatar_url = (req.body.avatar_url as string) || null;
  }
  if (Object.keys(payload).length > 0) await updateGroup(groupId, payload);
  res.json({ ok: true });
});

app.post("/api/groups/:id/avatar", avatarUpload.single("avatar"), requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const group = await getGroupById(groupId);
  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }
  const members = await getGroupMembersWithUsers(groupId);
  const myRole = members.find((m) => m.user_id === user.userId)?.role;
  const isCreator = myRole === "creator";
  if (!isCreator) {
    res.status(403).json({ message: "Only the group creator can change the group avatar" });
    return;
  }
  const file = req.file;
  if (!file || !file.buffer) {
    res.status(400).json({ message: "No image file provided; use multipart field 'avatar'" });
    return;
  }
  if (!supabase) {
    res.status(500).json({ message: "Storage not configured" });
    return;
  }
  const storagePath = `group/${groupId}/avatar.jpg`;
  const { error: uploadErr } = await supabase.storage.from("avatars").upload(storagePath, file.buffer, {
    contentType: file.mimetype === "image/png" ? "image/png" : file.mimetype === "image/webp" ? "image/webp" : "image/jpeg",
    upsert: true,
  });
  if (uploadErr) {
    console.error("Group avatar upload error:", uploadErr);
    res.status(500).json({ message: "Failed to upload image" });
    return;
  }
  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const publicUrl = urlData?.publicUrl ?? "";
  if (!publicUrl) {
    res.status(500).json({ message: "Failed to get image URL" });
    return;
  }
  const ok = await updateGroup(groupId, { avatar_url: publicUrl });
  if (!ok) {
    res.status(500).json({ message: "Failed to update group" });
    return;
  }
  chatLog("Group", "Avatar updated", `group=${groupId}`);
  res.json({ avatar_url: publicUrl });
});

app.delete("/api/groups/:id", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const group = await getGroupById(groupId);
  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }
  if (group.created_by !== user.userId) {
    res.status(403).json({ message: "Only creator can delete group" });
    return;
  }
  await deleteGroup(groupId);
  res.json({ ok: true });
});

app.post("/api/groups/:id/members/remove", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const targetUserId = (req.body?.user_id as string)?.trim();
  if (!targetUserId) {
    res.status(400).json({ message: "user_id required" });
    return;
  }
  await removeGroupMember(groupId, targetUserId);
  res.json({ ok: true });
});

app.patch("/api/groups/:id/members/role", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const groupId = req.params.id;
  const targetUserId = (req.body?.user_id as string)?.trim();
  const role = req.body?.role as "admin" | "member";
  if (!targetUserId || !role) {
    res.status(400).json({ message: "user_id and role required" });
    return;
  }
  await setGroupMemberRole(groupId, targetUserId, role);
  res.json({ ok: true });
});

// ---------- Connections (for group "Add members" - list people current user is connected to) ----------
app.get("/api/connections", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const connectionIds = await listConnectionUserIds(user.userId);
  const list: { id: string; username: string | null; avatar_url: string | null; display_name: string | null }[] = [];
  for (const id of connectionIds) {
    const u = await getUserById(id);
    list.push({
      id,
      username: (u?.username as string) ?? null,
      avatar_url: (u as { avatar_url?: string | null })?.avatar_url ?? null,
      display_name: (u?.username as string) ?? (u as { display_name?: string | null })?.display_name ?? null,
    });
  }
  res.json(list);
});

// ---------- Group invites ----------
app.get("/api/groups/:id/invites", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const isMember = await isGroupMember(groupId, user.userId);
  if (!isMember) {
    res.status(403).json({ message: "Not a member" });
    return;
  }
  const invites = await getGroupInvites(groupId);
  const out = await Promise.all(
    invites.map(async (inv) => {
      const inviter = await getUserById(inv.invited_by);
      const invitee = await getUserById(inv.invited_user_id);
      return {
        id: inv.id,
        group_id: inv.group_id,
        invited_by: inv.invited_by,
        invited_user_id: inv.invited_user_id,
        status: inv.status,
        created_at: inv.created_at,
        updated_at: inv.updated_at,
        inviter_username: (inviter?.username as string) ?? null,
        invitee_username: (invitee?.username as string) ?? null,
      };
    })
  );
  res.json(out);
});

app.post("/api/groups/:id/invites", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const groupId = req.params.id;
  const invitedUserId = (req.body?.invited_user_id as string)?.trim();
  if (!invitedUserId) {
    res.status(400).json({ message: "invited_user_id required" });
    return;
  }
  const members = await getGroupMembersWithUsers(groupId);
  const myRole = members.find((m) => m.user_id === user.userId)?.role;
  const isAdmin = myRole === "creator" || myRole === "admin";
  if (!isAdmin) {
    res.status(403).json({ message: "Only admins can invite" });
    return;
  }
  const result = await createGroupInvite(groupId, user.userId, invitedUserId);
  if ("error" in result) {
    res.status(400).json({ message: result.error });
    return;
  }
  chatLog("Group", "Invite sent", `group=${groupId} to=${invitedUserId} by=${user.userId}`);
  const group = await getGroupById(groupId);
  const groupName = (group as { name?: string } | null)?.name ?? "a group";
  await notifyUsers([invitedUserId], {
    type: "group_invite",
    title: `${user.username ? `@${user.username}` : "Someone"} invited you to ${groupName}`,
    body: "Accept to join the group chat.",
    payload: { invite_id: result.invite_id, group_id: groupId, group_name: groupName, inviter_username: user.username },
  });
  res.status(201).json({ invite_id: result.invite_id });
});

// ---------- Calls ----------
app.post("/api/calls/start", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const conversationId = (req.body?.conversation_id as string)?.trim();
  const callType = ((req.body?.call_type as string) || "audio") as "audio" | "video";
  if (!conversationId) {
    res.status(400).json({ message: "conversation_id required" });
    return;
  }
  const parsed = parseConversationId(conversationId, user.userId);
  if (!parsed || parsed.type !== "whisper") {
    res.status(400).json({ message: "Only 1:1 calls supported" });
    return;
  }
  const otherUser = await getUserById(parsed.otherUserId);
  if (!getOnlineUserIds().includes(parsed.otherUserId)) {
    const name = (otherUser?.username as string) ? `@${otherUser?.username as string}` : "This person";
    res.status(409).json({ message: `${name} is offline right now, so the call can't be placed.`, reason: "callee_offline" });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const log: CallLogEntry = {
    id,
    call_type: callType,
    called_to: (otherUser?.username as string) ?? "",
    date,
    call_time: time,
    started_at: now.toISOString(),
    ended_at: null,
    status: "started",
    conversation_id: conversationId,
    other_user_id: parsed.otherUserId,
  };
  await appendCallLog(user.userId, log);
  chatLog("Archive", "Call log created", `id=${id} type=${callType} conv=${conversationId}`);
  await notifyUsers([parsed.otherUserId], {
    type: "call",
    title: `${user.username ? `@${user.username}` : "Someone"} is calling you`,
    body: callType === "video" ? "Video call" : "Audio call",
    payload: { conversation_id: conversationId, call_type: callType, call_log_id: id, from_user_id: user.userId },
  });
  res.status(201).json({ call_log_id: id });
});

app.patch("/api/calls/:id/end", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const callLogId = req.params.id;
  const status = (req.body?.status as string) || "completed";
  const durationSeconds = req.body?.duration_seconds as number | undefined;
  if (!supabase) {
    res.status(503).json({ message: "Database not configured" });
    return;
  }
  const { data: row } = await supabase.from("user_chat_data").select("data").eq("user_id", user.userId).maybeSingle();
  const data = (row as { data?: { whispers?: { call_logs?: CallLogEntry[] } } })?.data;
  const logs = data?.whispers?.call_logs ?? [];
  const log = logs.find((l: CallLogEntry) => l.id === callLogId);
  if (!log) {
    res.status(404).json({ message: "Call log not found" });
    return;
  }
  const updated = logs.map((l: CallLogEntry) =>
    l.id === callLogId
      ? {
          ...l,
          ended_at: new Date().toISOString(),
          status,
          duration_seconds: durationSeconds,
          duration_min_sec: durationSeconds != null ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}` : undefined,
        }
      : l
  );
  const nextData = { ...data, whispers: { ...data?.whispers, call_logs: updated } };
  await supabase.from("user_chat_data").upsert({ user_id: user.userId, data: nextData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  chatLog("Archive", "Call log updated", `id=${callLogId} status=${status} duration=${durationSeconds ?? "n/a"}`);
  res.json({ ok: true });
});

app.get("/api/calls/logs", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const conversationId = (req.query.conversation_id as string) || undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  const logs = await getCallLogs(user.userId, conversationId, limit, offset);
  const otherIds = [...new Set(logs.map((l) => l.other_user_id).filter(Boolean))] as string[];
  const [onlineIds, usersMap] = await Promise.all([
    Promise.resolve(getOnlineUserIds()),
    otherIds.length ? getUsersByIds(otherIds) : Promise.resolve(new Map()),
  ]);
  const list = logs.map((l) => {
    const otherId = l.other_user_id ?? "";
    const otherUser = otherId ? usersMap.get(otherId) : null;
    return {
      id: l.id,
      conversation_id: l.conversation_id ?? l.other_user_id ?? "",
      call_type: l.call_type,
      started_at: l.started_at ?? (l as { date?: string; call_time?: string }).date + "T" + (l as { call_time?: string }).call_time,
      ended_at: l.ended_at ?? null,
      duration_seconds: l.duration_seconds ?? null,
      status: l.status ?? "completed",
      other_user: {
        id: otherId,
        username: (otherUser?.username as string) ?? null,
        avatar_url: (otherUser as { avatar_url?: string | null })?.avatar_url ?? null,
        display_name: (otherUser?.username as string) ?? (otherUser as { display_name?: string | null })?.display_name ?? null,
        is_online: onlineIds.includes(otherId),
      },
    };
  });
  chatLog("Archive", "Call logs retrieved", `user=${user.userId} count=${list.length}${conversationId ? ` conv=${conversationId}` : ""}`);
  res.json({ logs: list });
});

app.delete("/api/calls/logs", requireAuth, async (req: express.Request & { currentUser?: CurrentUser }, res) => {
  const user = req.currentUser!;
  const callLogIds = Array.isArray(req.body?.call_log_ids) ? (req.body.call_log_ids as string[]) : [];
  if (!callLogIds.length) {
    res.json({ deleted: [] });
    return;
  }
  await removeCallLogs(user.userId, callLogIds);
  chatLog("Archive", "Call logs deleted", `user=${user.userId} ids=${callLogIds.join(",")}`);
  res.json({ deleted: callLogIds });
});

// ---------- Stub routes (return empty for now) ----------
app.post("/api/conversations/clear", requireAuth, (_req, res) => res.json({ cleared: [], failed: [] }));
app.post("/api/users/block", requireAuth, (_req, res) => res.json({ ok: true }));
app.post("/api/users/unblock", requireAuth, (_req, res) => res.json({ ok: true }));

// Global error handler so unhandled rejections from requireAuth or async routes don't crash the process
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Chat service error:", err);
  if (!res.headersSent) {
    res.status(500).json({ message: err instanceof Error ? err.message : "Internal server error" });
  }
});

const httpServer = http.createServer(app);
attachSocketIo(httpServer);

process.on("unhandledRejection", (reason, promise) => {
  const msg = reason && typeof reason === "object" && "message" in reason ? (reason as { message?: string }).message : String(reason);
  const code = reason && typeof reason === "object" && "code" in reason ? (reason as { code?: string }).code : undefined;
  console.error("[Chat] Unhandled promise rejection:", code ?? "", msg);
  if (code === "57014" || (typeof msg === "string" && msg.includes("statement timeout"))) {
    console.warn("[Chat] Supabase statement timeout – consider increasing statement_timeout or optimizing get_whisper_thread_messages.");
  }
});

httpServer.listen(PORT, () => {
  console.log(`Chat service (REST + Socket.IO) listening on port ${PORT}`);
});
