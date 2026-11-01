'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredAuthToken } from '@/lib/auth-storage';
import websocket from '@/services/websocket';

export type MessageReceived = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: string;
  created_at: string;
};

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const connectAttemptRef = useRef(false);

  const connect = useCallback(async () => {
    const token = getStoredAuthToken();
    if (!token || connectAttemptRef.current) return;
    connectAttemptRef.current = true;
    try {
      await websocket.connect(token);
      setIsConnected(websocket.isConnected());
    } catch {
      setIsConnected(false);
    } finally {
      connectAttemptRef.current = false;
    }
  }, []);

  // The connection is app-wide (opened by SocketProvider in the dashboard layout); this hook
  // only makes sure it exists and tracks its status. It never disconnects on unmount, so
  // leaving the chat page no longer drops calls and presence.
  useEffect(() => {
    const token = getStoredAuthToken();
    if (token) void connect();
    setIsConnected(websocket.isConnected());
    return websocket.onStatus(setIsConnected);
  }, [connect]);

  const sendMessage = useCallback(
    (conversationId: string, senderId: string, content: string, contentType: string = 'text') => {
      websocket.sendMessage(conversationId, senderId, content, contentType);
    },
    []
  );

  const onMessageReceived = useCallback((callback: (message: MessageReceived) => void) => {
    websocket.onMessageReceived(callback);
  }, []);

  const offMessageReceived = useCallback((callback: (message: MessageReceived) => void) => {
    websocket.offMessageReceived(callback);
  }, []);

  const joinConversation = useCallback((conversationId: string, userId: string) => {
    websocket.joinConversation(conversationId, userId);
  }, []);

  const leaveConversation = useCallback((conversationId: string, userId: string) => {
    websocket.leaveConversation(conversationId, userId);
  }, []);

  const emitConversationRead = useCallback((conversationId: string, userId: string) => {
    websocket.emitConversationRead(conversationId, userId);
  }, []);

  const onConversationRead = useCallback((callback: (payload: { conversation_id: string; user_id: string }) => void) => {
    websocket.onConversationRead(callback);
  }, []);

  const onTypingIndicator = useCallback((callback: (payload: { conversation_id?: string; user_id: string; typing: boolean }) => void) => {
    websocket.onTypingIndicator(callback);
  }, []);

  const onMessageDeleted = useCallback((callback: (payload: { conversation_id: string; message_ids: string[] }) => void) => {
    websocket.onMessageDeleted(callback);
  }, []);

  const onUserOnline = useCallback((callback: (payload: { user_id: string }) => void) => websocket.onUserOnline(callback), []);

  const onUserOffline = useCallback((callback: (payload: { user_id: string }) => void) => websocket.onUserOffline(callback), []);

  const startTyping = useCallback((conversationId: string, userId: string) => {
    websocket.startTyping(conversationId, userId);
  }, []);

  const stopTyping = useCallback((conversationId: string, userId: string) => {
    websocket.stopTyping(conversationId, userId);
  }, []);

  return {
    connect,
    sendMessage,
    onMessageReceived,
    offMessageReceived,
    onMessageDeleted,
    onUserOnline,
    onUserOffline,
    joinConversation,
    leaveConversation,
    emitConversationRead,
    onConversationRead,
    onTypingIndicator,
    startTyping,
    stopTyping,
    isConnected: isConnected || websocket.isConnected(),
  };
}
