import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { getCurrentUserFromRequest } from "./auth";
import { isGroupMember, parseConversationId } from "./db";
import { attachHuddleRoom } from "./huddle-room";
import { attachSparkRoom } from "./spark-room";

export type MessageReceivedPayload = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: string;
  created_at: string;
  sender_username?: string | null;
  reply_to_message_id?: string;
  reply_to_content?: string;
  reply_to_sender_id?: string;
  reply_to_sender_username?: string;
};

let io: Server | null = null;

/** Presence: userId -> Set of socket ids (multiple tabs per user). */
const presenceByUser = new Map<string, Set<string>>();

/** Returns user ids that are currently online (have at least one connected socket). */
export function getOnlineUserIds(): string[] {
  return Array.from(presenceByUser.keys());
}

function addPresence(userId: string, socketId: string): boolean {
  let set = presenceByUser.get(userId);
  if (!set) {
    set = new Set<string>();
    presenceByUser.set(userId, set);
  }
  set.add(socketId);
  return set.size === 1;
}

function removePresence(userId: string, socketId: string): boolean {
  const set = presenceByUser.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    presenceByUser.delete(userId);
    return true;
  }
  return false;
}

/** Attach Socket.IO to the HTTP server; auth via handshake auth.token (JWT). */
export function attachSocketIo(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) {
        next(new Error("Missing token"));
        return;
      }
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as import("express").Request;
      const user = await getCurrentUserFromRequest(req);
      if (!user) {
        next(new Error("Invalid token"));
        return;
      }
      (socket as import("socket.io").Socket & { userId?: string }).userId = user.userId;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as import("socket.io").Socket & { userId?: string }).userId;
    if (!userId) return;
    socket.join(userId);
    attachHuddleRoom(io!, socket, userId);
    attachSparkRoom(socket, userId);

    const becameOnline = addPresence(userId, socket.id);
    if (becameOnline && io) io.emit("user:online", { user_id: userId });

    // Only parties to a whisper, or members of a group, may join its room (rooms carry message broadcasts).
    socket.on("join:conversation", async (data: { conversation_id?: string; user_id?: string }) => {
      const convId = typeof data?.conversation_id === "string" ? data.conversation_id : "";
      const parsed = convId ? parseConversationId(convId, userId) : null;
      if (!parsed) return;
      try {
        if (parsed.type === "group" && !(await isGroupMember(parsed.groupId, userId))) return;
        socket.join(convId);
      } catch (err) {
        console.error("[ws] join:conversation check failed:", err);
      }
    });

    socket.on("leave:conversation", (data: { conversation_id?: string }) => {
      const convId = data?.conversation_id;
      if (convId) socket.leave(convId);
    });

    socket.on("typing:start", (data: { conversation_id?: string; user_id?: string }) => {
      const convId = data?.conversation_id;
      if (convId && socket.rooms.has(convId)) socket.to(convId).emit("typing:indicator", { conversation_id: convId, user_id: userId, typing: true });
    });

    socket.on("typing:stop", (data: { conversation_id?: string; user_id?: string }) => {
      const convId = data?.conversation_id;
      if (convId && socket.rooms.has(convId)) socket.to(convId).emit("typing:indicator", { conversation_id: convId, user_id: userId, typing: false });
    });

    socket.on("conversation:read", (data: { conversation_id?: string; user_id?: string }) => {
      const convId = data?.conversation_id;
      if (convId && socket.rooms.has(convId)) socket.to(convId).emit("conversation:read", { conversation_id: convId, user_id: userId });
    });

    // ----- Call signaling (1:1 whisper only) -----
    socket.on("call:start", (data: { conversation_id?: string; call_type?: string; initiator_id?: string; call_log_id?: string }) => {
      const convId = data?.conversation_id;
      const initiatorId = userId;
      if (!convId) return;
      const parsed = parseConversationId(convId, initiatorId);
      if (!parsed || parsed.type !== "whisper") return;
      const calleeId = parsed.otherUserId;
      socket.to(calleeId).emit("call:incoming", {
        conversation_id: convId,
        call_type: data?.call_type ?? "video",
        initiator_id: initiatorId,
        call_log_id: data?.call_log_id ?? null,
      });
    });

    socket.on("call:accept", (data: { conversation_id?: string; user_id?: string; call_log_id?: string }) => {
      const convId = data?.conversation_id;
      const calleeId = userId;
      if (!convId) return;
      const parsed = parseConversationId(convId, calleeId);
      if (!parsed || parsed.type !== "whisper") return;
      const callerId = parsed.otherUserId;
      socket.to(callerId).emit("call:accepted", {
        conversation_id: convId,
        call_log_id: data?.call_log_id ?? null,
        callee_id: calleeId,
      });
    });

    socket.on("call:reject", (data: { conversation_id?: string; call_log_id?: string; user_id?: string }) => {
      const convId = data?.conversation_id;
      const rejecterId = userId;
      if (!convId) return;
      const parsed = parseConversationId(convId, rejecterId);
      if (!parsed || parsed.type !== "whisper") return;
      const otherId = parsed.otherUserId;
      socket.to(otherId).emit("call:rejected", { conversation_id: convId, call_log_id: data?.call_log_id ?? null });
    });

    socket.on("call:end", (data: { conversation_id?: string; call_log_id?: string; status?: string; user_id?: string }) => {
      const convId = data?.conversation_id;
      const enderId = userId;
      if (!convId) return;
      const parsed = parseConversationId(convId, enderId);
      if (!parsed || parsed.type !== "whisper") return;
      const otherId = parsed.otherUserId;
      socket.to(otherId).emit("call:ended", {
        conversation_id: convId,
        call_log_id: data?.call_log_id ?? null,
        status: data?.status ?? "completed",
      });
    });

    socket.on("webrtc:offer", (data: { conversation_id?: string; user_id?: string; sdp?: { type?: string; sdp?: string } }) => {
      const convId = data?.conversation_id;
      const senderId = userId;
      if (!convId || !data?.sdp) return;
      const parsed = parseConversationId(convId, senderId);
      if (!parsed || parsed.type !== "whisper") return;
      socket.to(parsed.otherUserId).emit("webrtc:offer", { conversation_id: convId, user_id: senderId, sdp: data.sdp });
    });

    socket.on("webrtc:answer", (data: { conversation_id?: string; user_id?: string; sdp?: { type?: string; sdp?: string } }) => {
      const convId = data?.conversation_id;
      const senderId = userId;
      if (!convId || !data?.sdp) return;
      const parsed = parseConversationId(convId, senderId);
      if (!parsed || parsed.type !== "whisper") return;
      socket.to(parsed.otherUserId).emit("webrtc:answer", { conversation_id: convId, user_id: senderId, sdp: data.sdp });
    });

    socket.on("webrtc:ice-candidate", (data: { conversation_id?: string; user_id?: string; candidate?: { candidate?: string; sdpMLineIndex?: number; sdpMid?: string } }) => {
      const convId = data?.conversation_id;
      const senderId = userId;
      if (!convId || !data?.candidate) return;
      const parsed = parseConversationId(convId, senderId);
      if (!parsed || parsed.type !== "whisper") return;
      socket.to(parsed.otherUserId).emit("webrtc:ice-candidate", {
        conversation_id: convId,
        user_id: senderId,
        candidate: data.candidate,
      });
    });

    // Presence snapshot for a list of users (the client's conversation list). Bounded.
    socket.on("presence:query", (data: { user_ids?: unknown }, ack?: (res: { online: string[] }) => void) => {
      if (typeof ack !== "function") return;
      const ids = Array.isArray(data?.user_ids) ? data.user_ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
      ack({ online: ids.filter((id) => presenceByUser.has(id)) });
    });

    // Screen share marker: tells the peer which incoming stream is the shared screen (null = stopped).
    socket.on("call:screen", (data: { conversation_id?: string; stream_id?: unknown }) => {
      const convId = data?.conversation_id;
      if (!convId) return;
      const parsed = parseConversationId(convId, userId);
      if (!parsed || parsed.type !== "whisper") return;
      const streamId = typeof data?.stream_id === "string" ? data.stream_id.slice(0, 128) : null;
      socket.to(parsed.otherUserId).emit("call:screen", { conversation_id: convId, stream_id: streamId });
    });

    socket.on("disconnect", () => {
      const wentOffline = removePresence(userId, socket.id);
      if (wentOffline && io) io.emit("user:offline", { user_id: userId });
    });
  });

  return io;
}

/** Emit to all sockets in a user's room (each socket joins its userId on connect). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(userId).emit(event, payload);
}

/** Emit message:received to all sockets in the conversation room (recipients get it; sender may get duplicate, frontend can dedupe by id). */
export function broadcastMessageReceived(conversationId: string, payload: MessageReceivedPayload): void {
  if (!io) return;
  io.to(conversationId).emit("message:received", payload);
}

/** Emit message:deleted to the conversation room. */
export function broadcastMessageDeleted(conversationId: string, messageIds: string[]): void {
  if (!io) return;
  io.to(conversationId).emit("message:deleted", { conversation_id: conversationId, message_ids: messageIds });
}
