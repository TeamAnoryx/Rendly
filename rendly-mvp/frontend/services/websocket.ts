import io, { Socket } from "socket.io-client";
import { getCcsWsUrl } from "@/lib/resolvedApiUrl";

type Handler = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * One app-wide Socket.IO connection to the chat server.
 *
 * Listeners live in a registry rather than on the socket object, so a listener added before
 * the socket connects (or across a reconnect) still fires. Two kinds of listener:
 *  - on(event, cb) adds a listener and returns an unsubscribe function (many per event);
 *  - the legacy onX(cb) methods keep one "slot" per event and replace it (old behaviour,
 *    used by call signalling and the chat page).
 * Conversation rooms joined are re-joined after a reconnect.
 */
class WebSocketService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private connecting: Promise<void> | null = null;
  private listeners = new Map<string, Set<Handler>>();
  private slots = new Map<string, Handler>();
  private bound = new Set<string>();
  private joined = new Set<string>();
  private statusListeners = new Set<(connected: boolean) => void>();

  connect(token: string): Promise<void> {
    if (this.socket && this.token === token) {
      return this.socket.connected ? Promise.resolve() : this.connecting ?? Promise.resolve();
    }
    if (this.socket) this.disconnect();
    this.token = token;
    this.connecting = getCcsWsUrl().then(
      (url) =>
        new Promise<void>((resolve, reject) => {
          if (this.token !== token) {
            resolve();
            return;
          }
          const socket = io(url, {
            auth: { token },
            path: "/socket.io",
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
          });
          this.socket = socket;
          this.bound.clear();
          this.bindAll();
          let settled = false;
          socket.on("connect", () => {
            this.joined.forEach((id) => socket.emit("join:conversation", { conversation_id: id }));
            this.emitStatus(true);
            if (!settled) {
              settled = true;
              resolve();
            }
          });
          socket.on("disconnect", () => this.emitStatus(false));
          socket.on("connect_error", (err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
        })
    );
    const p = this.connecting;
    p.finally(() => {
      if (this.connecting === p) this.connecting = null;
    }).catch(() => undefined);
    return p;
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.token = null;
    this.bound.clear();
    this.joined.clear();
    this.emitStatus(false);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  onStatus(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(connected: boolean) {
    this.statusListeners.forEach((cb) => {
      try {
        cb(connected);
      } catch (err) {
        console.error("[ws] status listener failed", err);
      }
    });
  }

  private dispatch(event: string, payload: unknown) {
    const slot = this.slots.get(event);
    if (slot) {
      try {
        slot(payload);
      } catch (err) {
        console.error(`[ws] ${event} handler failed`, err);
      }
    }
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[ws] ${event} listener failed`, err);
      }
    });
  }

  private bind(event: string) {
    if (!this.socket || this.bound.has(event)) return;
    this.bound.add(event);
    this.socket.on(event, (payload: unknown) => this.dispatch(event, payload));
  }

  private bindAll() {
    new Set([...this.listeners.keys(), ...this.slots.keys()]).forEach((e) => this.bind(e));
  }

  /** Add a listener; returns a function that removes it. */
  on<T = unknown>(event: string, cb: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as Handler);
    this.bind(event);
    return () => {
      this.listeners.get(event)?.delete(cb as Handler);
    };
  }

  private setSlot(event: string, cb: Handler) {
    this.slots.set(event, cb);
    this.bind(event);
  }

  emit(event: string, data?: unknown): void {
    this.socket?.emit(event, data);
  }

  /** Emit and wait for the server's acknowledgement. Rejects when offline or on timeout. */
  emitWithAck<T = unknown>(event: string, data: unknown, timeoutMs = 8000): Promise<T> {
    const socket = this.socket;
    if (!socket || !socket.connected) return Promise.reject(new Error("Not connected to the chat server"));
    return new Promise<T>((resolve, reject) => {
      socket.timeout(timeoutMs).emit(event, data, (err: Error | null, res: T) => {
        if (err) reject(new Error("The chat server did not answer"));
        else resolve(res);
      });
    });
  }

  joinConversation(conversationId: string, _userId?: string): void {
    this.joined.add(conversationId);
    this.socket?.emit("join:conversation", { conversation_id: conversationId });
  }

  leaveConversation(conversationId: string, _userId?: string): void {
    this.joined.delete(conversationId);
    this.socket?.emit("leave:conversation", { conversation_id: conversationId });
  }

  sendMessage(conversationId: string, senderId: string, content: string, contentType: string = "text"): void {
    this.socket?.emit("message:send", {
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      content_type: contentType,
    });
  }

  onMessageReceived(callback: (message: {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    content_type: string;
    created_at: string;
  }) => void): void {
    this.on("message:received", callback);
  }

  offMessageReceived(callback: (message: {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    content_type: string;
    created_at: string;
  }) => void): void {
    this.listeners.get("message:received")?.delete(callback as Handler);
  }

  startTyping(conversationId: string, _userId?: string): void {
    this.socket?.emit("typing:start", { conversation_id: conversationId });
  }

  stopTyping(conversationId: string, _userId?: string): void {
    this.socket?.emit("typing:stop", { conversation_id: conversationId });
  }

  emitConversationRead(conversationId: string, _userId?: string): void {
    this.socket?.emit("conversation:read", { conversation_id: conversationId });
  }

  onConversationRead(callback: (payload: { conversation_id: string; user_id: string }) => void): void {
    this.setSlot("conversation:read", callback);
  }

  onTypingIndicator(callback: (payload: { conversation_id?: string; user_id: string; typing: boolean }) => void): void {
    this.setSlot("typing:indicator", callback);
  }

  onMessageDeleted(callback: (payload: { conversation_id: string; message_ids: string[] }) => void): void {
    this.setSlot("message:deleted", callback);
  }

  /** Presence: these add listeners (many components watch presence at once). */
  onUserOnline(callback: (payload: { user_id: string }) => void): () => void {
    return this.on("user:online", callback);
  }

  onUserOffline(callback: (payload: { user_id: string }) => void): () => void {
    return this.on("user:offline", callback);
  }

  /** Which of these users are online right now. */
  async queryPresence(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const res = await this.emitWithAck<{ online?: unknown }>("presence:query", { user_ids: userIds.slice(0, 500) });
    return Array.isArray(res?.online) ? (res.online as unknown[]).filter((x): x is string => typeof x === "string") : [];
  }

  // ----- Call signalling (1:1 audio/video). The server uses the authenticated user id. -----
  emitCallStart(conversationId: string, callType: string, _initiatorId?: string, callLogId?: string): void {
    this.socket?.emit("call:start", { conversation_id: conversationId, call_type: callType, call_log_id: callLogId });
  }

  emitCallAccept(conversationId: string, _userId?: string, callLogId?: string): void {
    this.socket?.emit("call:accept", { conversation_id: conversationId, call_log_id: callLogId });
  }

  emitCallReject(conversationId: string, callLogId?: string, _userId?: string): void {
    this.socket?.emit("call:reject", { conversation_id: conversationId, call_log_id: callLogId });
  }

  emitCallEnd(conversationId: string, callLogId?: string, status?: string, _userId?: string): void {
    this.socket?.emit("call:end", { conversation_id: conversationId, call_log_id: callLogId, status: status ?? "completed" });
  }

  emitWebrtcOffer(conversationId: string, userId: string, sdp: RTCSessionDescriptionInit): void {
    this.socket?.emit("webrtc:offer", { conversation_id: conversationId, user_id: userId, sdp });
  }

  emitWebrtcAnswer(conversationId: string, userId: string, sdp: RTCSessionDescriptionInit): void {
    this.socket?.emit("webrtc:answer", { conversation_id: conversationId, user_id: userId, sdp });
  }

  emitWebrtcIceCandidate(conversationId: string, userId: string, candidate: RTCIceCandidateInit): void {
    this.socket?.emit("webrtc:ice-candidate", { conversation_id: conversationId, user_id: userId, candidate });
  }

  /** Tell the peer which incoming stream is a screen share (true) or that sharing stopped (false). */
  emitScreenShare(conversationId: string, streamId: string | null): void {
    this.socket?.emit("call:screen", { conversation_id: conversationId, stream_id: streamId });
  }

  onCallIncoming(callback: (payload: {
    conversation_id: string;
    call_type: string;
    initiator_id: string;
    call_log_id: string | null;
  }) => void): void {
    this.setSlot("call:incoming", callback);
  }

  onCallAccepted(callback: (payload: { conversation_id: string; call_log_id: string | null; callee_id: string }) => void): void {
    this.setSlot("call:accepted", callback);
  }

  onCallRejected(callback: (payload: { conversation_id: string; call_log_id: string | null }) => void): void {
    this.setSlot("call:rejected", callback);
  }

  onCallEnded(callback: (payload: { conversation_id: string; call_log_id: string | null; status: string }) => void): void {
    this.setSlot("call:ended", callback);
  }

  onWebrtcOffer(callback: (payload: { conversation_id: string; user_id: string; sdp: RTCSessionDescriptionInit }) => void): void {
    this.setSlot("webrtc:offer", callback);
  }

  onWebrtcAnswer(callback: (payload: { conversation_id: string; user_id: string; sdp: RTCSessionDescriptionInit }) => void): void {
    this.setSlot("webrtc:answer", callback);
  }

  onWebrtcIceCandidate(callback: (payload: { conversation_id: string; user_id: string; candidate: RTCIceCandidateInit }) => void): void {
    this.setSlot("webrtc:ice-candidate", callback);
  }
}

export const websocket = new WebSocketService();
export default websocket;
