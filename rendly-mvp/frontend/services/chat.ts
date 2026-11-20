import { getChatApiUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';

export type ConversationListItem = {
  id: string;
  name: string;
  avatar_url: string | null;
  lastMessage: string | null;
  lastSeenAt: string | null;
  isFavorite: boolean;
  unreadCount: number;
  isOnline: boolean;
  isBlocked?: boolean;
  otherUserId?: string | null;
  lastMessageContentType?: 'text' | 'image' | 'audio';
  lastMessageSenderId?: string | null;
  /** The permanent Rendly Team conversation: always listed first and cannot be removed. */
  isTeam?: boolean;
};

/** Extra fields carried by a `content_type: 'token_transfer'` message (Rendly Tokens sent in a whisper). */
export type TokenTransferMessageFields = {
  transfer_id?: string | null;
  amount?: number | null;
  note?: string | null;
};

export type ChatMessage = TokenTransferMessageFields & {
  id: string;
  sender_id: string;
  content: string;
  content_type: string;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  sender_username?: string | null;
  deleted_for_everyone?: boolean;
  reply_to_message_id?: string;
  reply_to_content?: string;
  reply_to_sender_id?: string;
  reply_to_sender_username?: string;
};

export type CallLogListItem = {
  id: string;
  conversation_id: string;
  call_type: 'audio' | 'video';
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: string;
  other_user: {
    id: string;
    username: string | null;
    avatar_url: string | null;
    display_name: string | null;
    is_online: boolean;
  };
};

export const chat = {
  async getSelfConversation(): Promise<{ id: string; name: string } | null> {
    const token = getStoredAuthToken();
    if (!token) return null;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ? { id: data.id, name: data.name ?? 'You' } : null;
  },

  async getConversations(): Promise<ConversationListItem[]> {
    const token = getStoredAuthToken();
    if (!token) return [];
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  /**
   * Get or create a 1:1 conversation with another user (for connection placeholders in Whispers).
   * Returns the conversation id and list item, or null if the backend does not support it or request fails.
   */
  async getOrCreateConversationWithUser(otherUserId: string): Promise<{ id: string; name: string; avatar_url: string | null; otherUserId: string } | null> {
    const token = getStoredAuthToken();
    if (!token || !otherUserId) return null;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ other_user_id: otherUserId }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { id?: string; name?: string; avatar_url?: string | null; other_user_id?: string } | null;
    if (!data?.id) return null;
    return {
      id: data.id,
      name: data.name ?? 'User',
      avatar_url: data.avatar_url ?? null,
      otherUserId: data.other_user_id ?? otherUserId,
    };
  },

  async setFavorite(conversationId: string, isFavorite: boolean): Promise<void> {
    const token = getStoredAuthToken();
    if (!token) return;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/favorite`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ is_favorite: isFavorite }),
    });
    if (!res.ok) throw new Error('Failed to update favorite');
  },

  async markRead(conversationId: string): Promise<void> {
    const token = getStoredAuthToken();
    if (!token) return;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to mark read');
  },

  /** Load messages for a conversation. Returns messages (excluding deleted_ids); backend may also return deleted_ids and view_once_consumed for client-side filtering. */
  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const token = getStoredAuthToken();
    if (!token) return [];
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({})))?.message ?? 'Failed to load messages';
      throw new Error(msg);
    }
    const data = (await res.json()) as { messages?: ChatMessage[]; deleted_ids?: string[]; view_once_consumed?: string[] };
    const list = data?.messages ?? [];
    const deletedSet = new Set(data?.deleted_ids ?? []);
    if (deletedSet.size === 0) return Array.isArray(list) ? list : [];
    return Array.isArray(list) ? list.filter((m) => !deletedSet.has(m.id)) : [];
  },

  async clearConversations(conversationIds: string[]): Promise<{ cleared: string[]; failed: string[] }> {
    const token = getStoredAuthToken();
    if (!token || !conversationIds.length) return { cleared: [], failed: [] };
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversation_ids: conversationIds }),
    });
    if (!res.ok) throw new Error('Failed to clear conversations');
    return res.json();
  },

  async blockUsers(userIds: string[]): Promise<void> {
    const token = getStoredAuthToken();
    if (!token) return;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/users/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_ids: userIds }),
    });
    if (!res.ok) throw new Error('Failed to block users');
  },

  async unblockUser(userId: string): Promise<void> {
    const token = getStoredAuthToken();
    if (!token) return;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/users/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new Error('Failed to unblock');
  },

  async deleteMessagesForMe(conversationId: string, messageIds: string[]): Promise<void> {
    const token = getStoredAuthToken();
    if (!token || !messageIds.length) return;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/messages/delete-for-me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_ids: messageIds }),
    });
    if (!res.ok) throw new Error('Failed to delete for me');
  },

  async deleteMessagesForEveryone(conversationId: string, messageIds: string[]): Promise<{ deleted: string[] }> {
    const token = getStoredAuthToken();
    if (!token || !messageIds.length) return { deleted: [] };
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/messages/delete-for-everyone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_ids: messageIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.message || 'Failed to delete for everyone');
    }
    return res.json();
  },

  async unsendMessages(conversationId: string, messageIds: string[]): Promise<{ unsent: string[] }> {
    const token = getStoredAuthToken();
    if (!token || !messageIds.length) return { unsent: [] };
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/conversations/${conversationId}/messages/unsend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message_ids: messageIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.message || 'Failed to unsend');
    }
    return res.json();
  },

  /** Send a message to a conversation (1:1 or group). Returns the created message or null on failure; throws on network error or with server message when !res.ok. */
  async sendMessage(
    conversationId: string,
    content: string,
    options?: {
      content_type?: string;
      bucket_ref?: string;
      reply_to_message_id?: string;
      reply_to_content?: string;
      reply_to_sender_id?: string;
      reply_to_sender_username?: string;
      /** Required with content_type 'token_transfer': the ledger transfer this bubble represents. */
      transfer_id?: string;
    }
  ): Promise<ChatMessage | null> {
    const token = getStoredAuthToken();
    if (!token) return null;
    const base = await getChatApiUrl();
    const body: Record<string, unknown> = {
      content,
      content_type: options?.content_type ?? 'text',
      ...(options?.bucket_ref != null && { bucket_ref: options.bucket_ref }),
      ...(options?.transfer_id && { transfer_id: options.transfer_id }),
    };
    if (options?.reply_to_message_id) {
      body.reply_to_message_id = options.reply_to_message_id;
      body.reply_to_content = options.reply_to_content ?? '';
      body.reply_to_sender_id = options.reply_to_sender_id ?? '';
      body.reply_to_sender_username = options.reply_to_sender_username ?? '';
    }
    const res = await fetch(`${base}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string } | ChatMessage;
    if (!res.ok) {
      const msg = (data as { message?: string })?.message ?? `Failed to send (${res.status})`;
      throw new Error(msg);
    }
    return (data as ChatMessage)?.id ? (data as ChatMessage) : null;
  },

  // Call logs and call lifecycle (1:1 audio/video)
  async startCall(conversationId: string, callType: 'audio' | 'video'): Promise<{ call_log_id: string } | null> {
    const token = getStoredAuthToken();
    if (!token) return null;
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/calls/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversation_id: conversationId, call_type: callType }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? 'Failed to start call');
    const data = await res.json();
    return data?.call_log_id ? { call_log_id: data.call_log_id } : null;
  },

  async endCall(callLogId: string, status: 'completed' | 'missed' | 'rejected' | 'cancelled', durationSeconds?: number): Promise<void> {
    const token = getStoredAuthToken();
    if (!token) return;
    const base = await getChatApiUrl();
    const body: { status: string; duration_seconds?: number } = { status };
    if (durationSeconds != null && durationSeconds >= 0) body.duration_seconds = durationSeconds;
    const res = await fetch(`${base}/api/calls/${callLogId}/end`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? 'Failed to end call');
  },

  async getCallLogs(limit?: number, offset?: number): Promise<CallLogListItem[]> {
    const token = getStoredAuthToken();
    if (!token) return [];
    const base = await getChatApiUrl();
    const params = new URLSearchParams();
    if (limit != null) params.set('limit', String(limit));
    if (offset != null) params.set('offset', String(offset));
    const q = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${base}/api/calls/logs${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.logs) ? data.logs : [];
  },

  async getCallLogsForConversation(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<CallLogListItem[]> {
    const token = getStoredAuthToken();
    if (!token || !conversationId) return [];
    const base = await getChatApiUrl();
    const params = new URLSearchParams();
    params.set('conversation_id', conversationId);
    if (limit != null) params.set('limit', String(limit));
    if (offset != null) params.set('offset', String(offset));
    const res = await fetch(`${base}/api/calls/logs?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.logs) ? data.logs : [];
  },

  async deleteCallLogs(callLogIds: string[]): Promise<{ deleted: string[] }> {
    const token = getStoredAuthToken();
    if (!token || !callLogIds.length) return { deleted: [] };
    const base = await getChatApiUrl();
    const res = await fetch(`${base}/api/calls/logs`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ call_log_ids: callLogIds }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? 'Failed to delete call logs');
    const data = await res.json();
    return { deleted: Array.isArray(data?.deleted) ? data.deleted : [] };
  },
};
