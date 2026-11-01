'use client';

import React, { Suspense, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDashboard } from '@/hooks/useDashboard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useCallContext } from '@/context/CallContext';
import { chat, type CallLogListItem } from '@/services/chat';
import { getConnections, type Connection } from '@/services/connectionsApi';
import { groupsApi, type GroupListItem, type GroupInvitePending } from '@/services/groups';
import { GroupSettingsPanel } from '@/app/dashboard/chat/GroupSettingsPanel';
import { ActiveVideoCallView } from '@/app/dashboard/chat/ActiveVideoCallView';

type ChatTab = 'Group' | 'Whispers' | 'Archive';
type ConnectionFilter = 'all' | 'unread' | 'favorites';

/** Synthetic id for "You" row when backend self-conversation is not yet available (e.g. chat-service not hit). */
const SELF_PLACEHOLDER_ID = '__self__';

/** Prefix for connection placeholder rows (no conversation yet). Id format: connection:${otherUserId}. */
export const CONNECTION_PLACEHOLDER_PREFIX = 'connection:';

/** Build deterministic 1:1 conversation id (whisper_<smaller>_<larger>), matching backend db.ts whisperConversationId. */
function getWhisperConversationId(userIdA: string, userIdB: string): string {
  const [a, b] = [userIdA, userIdB].sort();
  return `whisper_${a}_${b}`;
}

/** SessionStorage key to persist selected conversation so messages survive HMR/remounts. */
const STORAGE_KEY_SELECTED_ID = 'rendly_chat_selected_id';

const CONVERSATION_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_KEY_CONVERSATIONS_CACHE = 'rendly_chat_conversations_cache';

/** Cache last loaded conversations (memory + sessionStorage) so dashboard loads instantly on refresh or different port. */
let conversationsCache: { userId: string; list: ConversationItem[] } | null = null;

function getStoredConversationsCache(userId: string): ConversationItem[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_CONVERSATIONS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId: string; list: ConversationItem[] };
    if (parsed.userId !== userId || !Array.isArray(parsed.list)) return null;
    return parsed.list;
  } catch {
    return null;
  }
}

function setStoredConversationsCache(userId: string, list: ConversationItem[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY_CONVERSATIONS_CACHE, JSON.stringify({ userId, list }));
  } catch {
    // ignore
  }
}

export type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  content_type: 'text' | 'image' | 'audio';
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  /** Set for group messages so UI can show who sent the message */
  sender_username?: string | null;
  /** True when message was unsent / deleted for everyone; show placeholder for others */
  deleted_for_everyone?: boolean;
  /** Reply reference (WhatsApp-style) */
  reply_to_message_id?: string;
  reply_to_content?: string;
  reply_to_sender_id?: string;
  reply_to_sender_username?: string;
};

export type ConversationItem = {
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
};

function formatLastSeen(isoOrNull: string | null) {
  if (!isoOrNull) return '';
  const d = new Date(isoOrNull);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ConversationRow({
  item,
  currentUserId,
  isActive,
  onClick,
  onStarClick,
  onAvatarClick,
  selectionMode,
  selected,
  onToggleSelect,
  onDoubleClick: onRowDoubleClick,
}: {
  item: ConversationItem;
  currentUserId?: string | null;
  isActive?: boolean;
  onClick: () => void;
  onStarClick: (e: React.MouseEvent) => void;
  onAvatarClick?: (src: string, label: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  const displayName = item.name || 'Unknown';
  let preview: string;
  if (item.isBlocked) {
    preview = 'Blocked';
  } else if (item.lastMessageContentType === 'image') {
    preview = item.lastMessageSenderId === currentUserId ? 'Image sent' : 'Image received';
  } else if (item.lastMessageContentType === 'audio') {
    preview = item.lastMessageSenderId === currentUserId ? 'Audio message sent' : 'Audio message received';
  } else {
    preview = item.lastMessage?.trim() ? item.lastMessage : 'Send new message...';
  }
  const timeText = formatLastSeen(item.lastSeenAt);

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.avatar_url && onAvatarClick) onAvatarClick(item.avatar_url, displayName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const rowContent = (
    <>
      {selectionMode && (
        <div
          className="chat-conv-row-checkbox-wrap"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(e);
          }}
          role="button"
          tabIndex={0}
          aria-label={selected ? 'Deselect' : 'Select'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleSelect?.(e as unknown as React.MouseEvent);
            }
          }}
        >
          <input
            type="checkbox"
            className="chat-conv-row-checkbox"
            checked={!!selected}
            readOnly
            tabIndex={-1}
            aria-hidden
          />
        </div>
      )}
      <div className="chat-conv-row-avatar-wrap">
        <div
          className="chat-conv-row-avatar-clip chat-conv-row-avatar-clip--clickable"
          onClick={item.avatar_url ? handleAvatarClick : undefined}
          title={item.avatar_url ? 'View photo' : undefined}
        >
          {item.avatar_url ? (
            <img src={item.avatar_url} alt="" className="chat-conv-row-avatar" referrerPolicy="no-referrer" />
          ) : (
            <span className="chat-conv-row-avatar chat-conv-row-avatar-initials">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <span
          className={`chat-conv-row-status ${item.isOnline ? 'chat-conv-row-status--online' : 'chat-conv-row-status--offline'}`}
          aria-label={item.isOnline ? 'Online' : 'Offline'}
        />
      </div>
      <div className="chat-conv-row-body">
        <div className="chat-conv-row-top">
          <div className="chat-conv-row-top-left">
            <div className="chat-conv-row-top-left-line">
              <span className="chat-conv-row-name">{displayName}</span>
              {item.isBlocked ? (
                <span className="chat-conv-row-blocked-label">
                  <BlockedBadgeIcon />
                  Blocked
                </span>
              ) : item.unreadCount > 0 ? (
                <span className="chat-conv-row-unread-pill">{item.unreadCount} unread</span>
              ) : null}
            </div>
            <span className="chat-conv-row-preview">{preview}</span>
          </div>
          <div className="chat-conv-row-right">
            {!item.isBlocked && timeText ? <span className="chat-conv-row-time">{timeText}</span> : null}
            {!item.isBlocked && (
              <button
                type="button"
                className="chat-conv-row-star"
                onClick={onStarClick}
                aria-label={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill={item.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className={`chat-conv-row ${isActive ? 'chat-conv-row--active' : ''} ${item.isFavorite ? 'chat-conv-row--favorite' : ''} ${item.isBlocked ? 'chat-conv-row--blocked' : ''} ${selectionMode ? 'chat-conv-row--selection' : ''}`}
      {...(selectionMode ? { 'data-keep-connection-selection-open': true } : {})}
      onClick={onClick}
      onDoubleClick={onRowDoubleClick}
      onKeyDown={handleKeyDown}
      aria-label={item.isBlocked ? `Blocked: ${displayName}. Click to unblock.` : `Chat with ${displayName}`}
    >
      {rowContent}
    </div>
  );
}

/* Mock autocomplete: replace with API later (username / message search) */
function getSuggestions(query: string) {
  if (!query.trim()) return [];
  const q = query.trim().toLowerCase();
  const mockUsers = ['alex_rendly', 'sam_connects', 'jordan_dev', 'casey_builder', 'riley_whisper'];
  const mockMessages = ['See you at the huddle', 'Thanks for the feedback', 'Let\'s connect tomorrow'];
  const suggestions: { type: 'username' | 'message'; label: string; sub?: string }[] = [];
  mockUsers.forEach((u) => {
    if (u.includes(q)) suggestions.push({ type: 'username', label: u, sub: 'Username' });
  });
  mockMessages.forEach((m) => {
    if (m.toLowerCase().includes(q)) suggestions.push({ type: 'message', label: m, sub: 'Message' });
  });
  return suggestions.slice(0, 6);
}

function SearchConnections() {
  const [query, setQuery] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestions = getSuggestions(query);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openAutocomplete = focused && (query.length > 0 || suggestions.length > 0);

  return (
    <div className="chat-search-wrap" ref={containerRef}>
      <div className="chat-search-pill">
        <span className="chat-search-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </span>
        <input
          type="text"
          className="chat-search-input"
          placeholder="Search connections"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowAutocomplete(true);
          }}
          onFocus={() => {
            setFocused(true);
            if (query || suggestions.length) setShowAutocomplete(true);
          }}
          onBlur={() => setFocused(false)}
          aria-label="Search connections"
          aria-autocomplete="list"
          aria-expanded={openAutocomplete}
          aria-controls="chat-search-suggestions"
        />
      </div>
      {openAutocomplete && (
        <ul id="chat-search-suggestions" className="chat-search-suggestions" role="listbox">
          {suggestions.length === 0 ? (
            <li className="chat-search-suggestion chat-search-suggestion--empty" role="option">No matches</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={`${s.type}-${i}`}
                className="chat-search-suggestion"
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(s.label);
                  setShowAutocomplete(false);
                }}
              >
                <span className="chat-search-suggestion-type">{s.sub}</span>
                <span className="chat-search-suggestion-label">{s.label}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

const TABS: { id: ChatTab; label: string }[] = [
  { id: 'Whispers', label: 'Whispers' },
  { id: 'Group', label: 'Group' },
  { id: 'Archive', label: 'Archive' },
];

function WhispersIcon() {
  return (
    <svg className="chat-pill-btn-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg className="chat-pill-btn-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="chat-pill-btn-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function ClearChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function BlockUserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function RefreshListIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function BlockedBadgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function VideoCallIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function AudioCallIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function EndCallIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function VideoOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 002-2V4a2 2 0 00-2-2h-1" />
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M23 7v10a2 2 0 01-2 2h-1" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const TAB_ICONS: Record<ChatTab, React.ReactNode> = {
  Whispers: <WhispersIcon />,
  Group: <GroupIcon />,
  Archive: <ArchiveIcon />,
};

function ChatPageRoot({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`chat-page${className ? ` ${className}` : ''}`}>{children}</div>;
}

function GroupRow({
  group,
  isActive,
  onClick,
  onStarClick,
}: {
  group: GroupListItem;
  isActive: boolean;
  onClick: () => void;
  onStarClick: (e: React.MouseEvent) => void;
}) {
  const preview = group.lastMessage
    ? group.lastMessage.length > 28
      ? group.lastMessage.slice(0, 28) + '...'
      : group.lastMessage
    : 'Send new message...';
  const senderPrefix = group.lastMessageSenderUsername ? `@${group.lastMessageSenderUsername}: ` : '';
  const timeText = formatLastSeen(group.lastMessageAt);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`chat-group-row ${isActive ? 'chat-group-row--active' : ''} ${group.isFavorite ? 'chat-group-row--favorite' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Group ${group.name}`}
    >
      <div className="chat-group-row-avatar-wrap">
        {group.avatar_url ? (
          <img src={group.avatar_url} alt="" className="chat-group-row-avatar" />
        ) : (
          <div className="chat-group-row-avatar chat-group-row-avatar--initials">
            {(group.name || 'G').slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="chat-group-row-body">
        <div className="chat-group-row-top">
          <span className="chat-group-row-name">{group.name || 'Group'}</span>
          {group.unreadCount > 0 && (
            <span className="chat-group-row-unread">{group.unreadCount} unread</span>
          )}
          <span className="chat-group-row-time">{timeText}</span>
        </div>
        <div className="chat-group-row-preview">
          {senderPrefix}{preview}
        </div>
      </div>
      <button
        type="button"
        className="chat-group-row-star"
        onClick={onStarClick}
        aria-label={group.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={group.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {group.isFavorite ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

function GroupInviteRow({
  invite,
  onAccept,
  onReject,
}: {
  invite: GroupInvitePending;
  onAccept: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}) {
  const groupName = invite.group_name || 'Group';
  const inviter = invite.inviter_username ? `@${invite.inviter_username}` : 'Someone';
  const [busy, setBusy] = useState(false);
  const handleAccept = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    Promise.resolve(onAccept()).finally(() => setBusy(false));
  };
  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    Promise.resolve(onReject()).finally(() => setBusy(false));
  };
  return (
    <div className="chat-group-invite-row" role="listitem">
      <div className="chat-group-invite-row-body">
        <span className="chat-group-invite-row-badge">Invite</span>
        <span className="chat-group-invite-row-name">{groupName}</span>
        <span className="chat-group-invite-row-from">from {inviter}</span>
      </div>
      <div className="chat-group-invite-row-actions">
        <button
          type="button"
          className="chat-group-invite-row-btn chat-group-invite-row-btn--accept"
          onClick={handleAccept}
          disabled={busy}
          aria-label="Accept invite"
        >
          Accept
        </button>
        <button
          type="button"
          className="chat-group-invite-row-btn chat-group-invite-row-btn--reject"
          onClick={handleReject}
          disabled={busy}
          aria-label="Reject invite"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function formatMessageTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatCallDuration(seconds: number | null, status: string) {
  if (status === 'missed' || status === 'rejected' || status === 'cancelled') return '-';
  if (seconds == null || seconds < 0) return '-';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} min`;
  return `${mins}.${String(Math.round((secs / 60) * 100)).padStart(2, '0')} min`;
}

function formatCallDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return `Today ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function CallLogRow({
  log,
  onClick,
  selectionMode,
  selected,
  onToggleSelect,
  onDoubleClick,
}: {
  log: CallLogListItem;
  onClick: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  const name = log.other_user?.username ?? log.other_user?.display_name ?? (log.other_user?.id ? 'User' : 'Unknown');
  const durationText = formatCallDuration(log.duration_seconds, log.status);
  const dateText = formatCallDate(log.started_at);
  const isMissed = (log.status ?? '').toLowerCase() === 'missed';
  return (
    <div
      role="button"
      tabIndex={0}
      className={`chat-conv-row chat-archive-log-row ${isMissed ? 'chat-archive-log-row--missed' : ''} ${selectionMode ? 'chat-conv-row--selection' : ''}`}
      {...(selectionMode ? { 'data-keep-call-log-selection-open': true } : {})}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Call with ${name}, ${log.call_type}, ${dateText}`}
    >
      {selectionMode && (
        <div
          className="chat-conv-row-checkbox-wrap"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(e);
          }}
          role="button"
          tabIndex={0}
          aria-label={selected ? 'Deselect' : 'Select'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleSelect?.(e as unknown as React.MouseEvent);
            }
          }}
        >
          <input
            type="checkbox"
            className="chat-conv-row-checkbox"
            checked={!!selected}
            readOnly
            tabIndex={-1}
            aria-hidden
          />
        </div>
      )}
      <div className="chat-conv-row-avatar-wrap">
        {log.other_user?.avatar_url ? (
          <img src={log.other_user.avatar_url} alt="" className="chat-conv-row-avatar" referrerPolicy="no-referrer" />
        ) : (
          <span className="chat-conv-row-avatar chat-conv-row-avatar-initials">{name.slice(0, 2).toUpperCase()}</span>
        )}
        <span
          className={`chat-conv-row-status ${log.other_user?.is_online ? 'chat-conv-row-status--online' : 'chat-conv-row-status--offline'}`}
          aria-label={log.other_user?.is_online ? 'Online' : 'Offline'}
        />
      </div>
      <div className="chat-conv-row-body">
        <div className="chat-conv-row-top">
          <div className="chat-conv-row-top-left">
            <span className="chat-conv-row-name">{name}</span>
          </div>
          <div className="chat-conv-row-right">
            <span className="chat-archive-log-date">{dateText}</span>
          </div>
        </div>
        <div className={`chat-archive-log-meta ${isMissed ? 'chat-archive-log-meta--missed' : ''}`}>
          <span className="chat-archive-log-type" aria-hidden>
            {isMissed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chat-archive-log-icon-missed">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : log.call_type === 'video' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" /></svg>
            )}
          </span>
          <span className={`chat-archive-log-duration ${isMissed ? 'chat-archive-log-duration--missed' : ''}`}>
            {isMissed ? 'Missed call' : durationText}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatMessageDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function MessageDateSeparator({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="chat-message-date-sep" role="separator">
      <span>{dateLabel}</span>
    </div>
  );
}

function formatCallTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ChatCallLogEntry({ log }: { log: CallLogListItem }) {
  const timeStr = formatCallTime(log.started_at);
  const isMissed = log.status === 'missed';
  const durationStr = formatCallDuration(log.duration_seconds, log.status);
  const callLabel = log.call_type === 'video' ? 'Video call' : 'Audio call';
  let text: string;
  if (isMissed) {
    text = `Missed ${callLabel.toLowerCase()}  •  ${timeStr}`;
  } else {
    text = durationStr === '-' ? `${callLabel}  •  ${timeStr}` : `${callLabel}  •  ${durationStr}  •  ${timeStr}`;
  }
  return (
    <div className="chat-call-log-entry" role="listitem">
      <span className="chat-call-log-entry-text">{text}</span>
    </div>
  );
}

function SentStatusChecks({ readAt, deliveredAt }: { readAt?: string | null; deliveredAt?: string | null }) {
  const read = !!readAt;
  const delivered = !!deliveredAt;
  const label = read ? 'Seen' : delivered ? 'Delivered' : 'Sent';
  return (
    <span className={`chat-message-checks ${read ? 'chat-message-checks--read' : ''}`}>
      {label}
    </span>
  );
}

/** Filling circular loader for image/audio while sending (sender side). */
function SendingCircleLoader() {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <span className="chat-message-sending-loader" aria-label="Sending">
      <svg width={16} height={16} viewBox={`0 0 ${r * 2 + 4} ${r * 2 + 4}`} className="chat-message-sending-loader-svg">
        <circle
          cx={r + 2}
          cy={r + 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={c}
          strokeDashoffset={c}
          className="chat-message-sending-loader-circle"
        />
      </svg>
    </span>
  );
}

function ChatAudioPlayer({ src, isSender }: { src: string; isSender: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onDurationChange = () => {
      setDuration(el.duration);
      if (!Number.isNaN(el.duration)) setReady(true);
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('durationchange', onDurationChange);
    el.addEventListener('ended', onEnded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    if (!Number.isNaN(el.duration)) setDuration(el.duration);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('durationchange', onDurationChange);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  }, [src]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    el.currentTime = Math.max(0, Math.min(1, x)) * duration;
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const timeStr = (s: number) => (Number.isNaN(s) || !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

  return (
    <div className={`chat-media chat-media--audio ${isSender ? 'chat-media--sender' : 'chat-media--receiver'}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="chat-audio-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="chat-audio-body">
        <div className="chat-audio-progress-wrap" onClick={seek} role="progressbar" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration} tabIndex={0} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}>
          <div className="chat-audio-progress-track" />
          <div className="chat-audio-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="chat-audio-time">{ready ? `${timeStr(currentTime)} / ${timeStr(duration)}` : '0:00 / 0:00'}</span>
      </div>
    </div>
  );
}

const UNSEND_2HR_MS = 2 * 60 * 60 * 1000;
const UNSEND_PROMPT_KEY = 'rendly_unsend_prompt_seen';

function MessageBubble({
  message,
  isSender,
  onImageClick,
  selectionMode,
  selected,
  onToggleSelect,
  onDoubleClick: onBubbleDoubleClick,
  onLongPress,
  onReplyQuoteClick,
  highlighted,
}: {
  message: ChatMessage;
  isSender: boolean;
  onImageClick?: (src: string, label: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onLongPress?: () => void;
  onReplyQuoteClick?: (messageId: string) => void;
  highlighted?: boolean;
}) {
  const handleImageClick = () => {
    if (message.content_type === 'image' && onImageClick) {
      onImageClick(message.content, 'Photo');
    }
  };

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onLongPress || !ref.current) return;
    const el = ref.current;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onTouchStart = () => {
      t = setTimeout(() => {
        t = null;
        onLongPress();
      }, 500);
    };
    const onTouchEnd = () => {
      if (t) clearTimeout(t);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      if (t) clearTimeout(t);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onLongPress]);

  const checkboxSide = isSender ? 'right' : 'left';
  const senderLabel = !isSender && message.sender_username ? `@${message.sender_username}` : null;
  const isDeletedForEveryone = !!message.deleted_for_everyone;
  const deletedPlaceholder = isDeletedForEveryone
    ? (isSender ? 'You unsent this message' : `${message.sender_username ? `@${message.sender_username}` : 'Message'} message deleted`)
    : null;
  const handleReplyQuoteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectionMode || !message.reply_to_message_id || !onReplyQuoteClick) return;
    onReplyQuoteClick(message.reply_to_message_id);
  };

  const senderStatusElement = isSender
    ? (message.id.startsWith('temp-') && (message.content_type === 'image' || message.content_type === 'audio')
      ? <SendingCircleLoader />
      : <SentStatusChecks readAt={message.read_at} deliveredAt={message.delivered_at} />)
    : null;

  return (
    <div
      ref={ref}
      data-message-id={message.id}
      className={`chat-message-row ${isSender ? 'chat-message-row--sender' : ''} ${selectionMode ? 'chat-message-row--selection' : ''} ${isDeletedForEveryone ? 'chat-message-row--deleted' : ''} ${highlighted ? 'chat-message-row--highlighted' : ''}`}
      onDoubleClick={selectionMode ? undefined : onBubbleDoubleClick}
    >
      {selectionMode && checkboxSide === 'left' && (
        <div
          className="chat-message-checkbox-wrap chat-message-checkbox-wrap--left"
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(e); }}
          role="button"
          tabIndex={0}
          aria-label={selected ? 'Deselect' : 'Select'}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelect?.(e as unknown as React.MouseEvent); } }}
        >
          <input type="checkbox" className="chat-message-checkbox" checked={!!selected} readOnly tabIndex={-1} aria-hidden />
        </div>
      )}
      <div
        className={`chat-message-bubble ${isSender ? 'chat-message-bubble--sender' : 'chat-message-bubble--receiver'}`}
        onClick={selectionMode ? (e) => { e.stopPropagation(); onToggleSelect?.(e); } : undefined}
      >
        {!isDeletedForEveryone && senderLabel && (
          <div className="chat-message-sender-label" aria-label={`Sent by ${message.sender_username}`}>
            {senderLabel}
          </div>
        )}
        {isDeletedForEveryone ? (
          <div className="chat-message-content chat-message-content--deleted">
            {deletedPlaceholder}
          </div>
        ) : (
          <>
            {message.reply_to_message_id && (
              <div
                className={`chat-message-reply-quote ${onReplyQuoteClick && !selectionMode ? 'chat-message-reply-quote--clickable' : ''}`}
                role={onReplyQuoteClick && !selectionMode ? 'button' : undefined}
                tabIndex={onReplyQuoteClick && !selectionMode ? 0 : undefined}
                onClick={handleReplyQuoteClick}
                onKeyDown={onReplyQuoteClick && !selectionMode ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleReplyQuoteClick(e as unknown as React.MouseEvent); } } : undefined}
                aria-label={onReplyQuoteClick && !selectionMode ? 'Jump to original message' : undefined}
              >
                <span className="chat-message-reply-quote-author">
                  {message.reply_to_sender_username ? `@${message.reply_to_sender_username}` : 'Message'}
                </span>
                <span className="chat-message-reply-quote-content">
                  {message.reply_to_content === 'Photo' || message.reply_to_content === 'Audio'
                    ? message.reply_to_content
                    : (message.reply_to_content ?? '').slice(0, 80) + ((message.reply_to_content?.length ?? 0) > 80 ? '…' : '')}
                </span>
              </div>
            )}
            <div className={`chat-message-content ${message.content_type !== 'text' ? 'chat-message-content--media' : ''}`}>
              {message.content_type === 'text' && message.content}
              {message.content_type === 'image' && (
                <div
                  className={`chat-media chat-media--image ${isSender ? 'chat-media--sender' : 'chat-media--receiver'} ${onImageClick ? 'chat-media--clickable' : ''}`}
                  role={onImageClick ? 'button' : undefined}
                  tabIndex={onImageClick ? 0 : undefined}
                  onClick={onImageClick ? handleImageClick : undefined}
                  onKeyDown={onImageClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleImageClick(); } } : undefined}
                  aria-label={onImageClick ? 'View photo' : undefined}
                >
                  <div className="chat-media-image-inner">
                    <img src={message.content} alt="Attachment" />
                  </div>
                </div>
              )}
              {message.content_type === 'audio' && (
                <ChatAudioPlayer src={message.content} isSender={isSender} />
              )}
            </div>
          </>
        )}
        <div className="chat-message-meta">
          <span className="chat-message-time">{formatMessageTime(message.created_at)}</span>
          {senderStatusElement}
        </div>
      </div>
      {selectionMode && checkboxSide === 'right' && (
        <div
          className="chat-message-checkbox-wrap chat-message-checkbox-wrap--right"
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(e); }}
          role="button"
          tabIndex={0}
          aria-label={selected ? 'Deselect' : 'Select'}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelect?.(e as unknown as React.MouseEvent); } }}
        >
          <input type="checkbox" className="chat-message-checkbox" checked={!!selected} readOnly tabIndex={-1} aria-hidden />
        </div>
      )}
    </div>
  );
}

function AttachIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ImageLightbox({
  src,
  label,
  onClose,
}: {
  src: string;
  label: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="chat-image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`View ${label}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chat-image-lightbox-wrap" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="chat-image-lightbox-close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <div className="chat-image-lightbox-content">
          <img src={src} alt={label} className="chat-image-lightbox-img" />
          <span className="chat-image-lightbox-label">{label}</span>
        </div>
      </div>
    </div>
  );
}

function ChatPageContent() {
  const { user: currentUser } = useDashboard();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const { sendMessage: wsSendMessage, onMessageReceived, offMessageReceived, onMessageDeleted, onUserOnline, onUserOffline, joinConversation, leaveConversation, emitConversationRead, onConversationRead, onTypingIndicator, startTyping, stopTyping, isConnected: wsConnected } = useWebSocket();
  const {
    callState,
    callType,
    conversationId: callConversationId,
    incomingCall,
    remoteStream,
    localStream,
    screenStream,
    remoteScreenStream,
    showScreenShareLayout,
    isMuted,
    isVideoOff,
    isScreenSharing,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    registerOnCallEnded,
  } = useCallContext();
  const [videoPanelWidthVw, setVideoPanelWidthVw] = useState(50);
  const [isResizingVideoPanel, setIsResizingVideoPanel] = useState(false);
  const [isMobileOrTablet, setIsMobileOrTablet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const update = () => setIsMobileOrTablet(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!isResizingVideoPanel) return;
    const onMove = (e: MouseEvent) => {
      const vw = Math.min(85, Math.max(30, (e.clientX / window.innerWidth) * 100));
      setVideoPanelWidthVw(vw);
    };
    const onUp = () => setIsResizingVideoPanel(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingVideoPanel]);
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ChatTab>('Whispers');
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callLogsInConversation, setCallLogsInConversation] = useState<CallLogListItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);
  const [connectionSelectionMode, setConnectionSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [messageActionLoading, setMessageActionLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showUnblockConfirm, setShowUnblockConfirm] = useState<string | null>(null);
  const [messagesLoadError, setMessagesLoadError] = useState<string | null>(null);
  const [callLogs, setCallLogs] = useState<CallLogListItem[]>([]);
  const [callLogSelectionMode, setCallLogSelectionMode] = useState(false);
  const [selectedCallLogIds, setSelectedCallLogIds] = useState<Set<string>>(new Set());
  const [callLogsRefreshing, setCallLogsRefreshing] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [archiveCallLogsLoading, setArchiveCallLogsLoading] = useState(false);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [pendingGroupInvites, setPendingGroupInvites] = useState<GroupInvitePending[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false);
  const [createGroupName, setCreateGroupName] = useState('');
  const [createGroupSubmitting, setCreateGroupSubmitting] = useState(false);
  const [groupViewOnly, setGroupViewOnly] = useState(false);
  const [groupAmAdmin, setGroupAmAdmin] = useState(true);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesListWrapRef = useRef<HTMLDivElement>(null);
  const messagesScrollContainerRef = useRef<HTMLDivElement>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesCacheRef = useRef<Record<string, ChatMessage[]>>({});
  /** Message ids we already counted for unread (per conv), so we don't double-count if the same event is delivered twice. Cleared when the user opens that conversation. */
  const unreadCountedIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    return registerOnCallEnded((convId: string) => {
      if (selectedIdRef.current !== convId) return;
      setCallLogsRefreshing(true);
      chat
        .getCallLogsForConversation(convId, 100, 0)
        .then((logs) => {
          setCallLogsInConversation(logs);
        })
        .finally(() => {
          setCallLogsRefreshing(false);
        });
    });
  }, [registerOnCallEnded]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'Group' || tab === 'Whispers' || tab === 'Archive') {
      setActiveTab(tab);
      if (tab === 'Group') {
        setSelectedId(null);
        setSelectedGroupId(null);
      }
    }
  }, [searchParams]);

  // A Spark video match opens its conversation with ?call=video&initiator=1|0. Only the
  // initiator starts the call; the other side gets the normal incoming-call prompt.
  const pendingMatchCallRef = useRef<{ conv: string; initiator: boolean } | null>(null);

  useEffect(() => {
    const conv = searchParams.get('conv');
    if (!conv) return;
    setActiveTab('Whispers');
    setSelectedId(conv);
    setSelectedGroupId(null);
    if (searchParams.get('call') === 'video') {
      pendingMatchCallRef.current = { conv, initiator: searchParams.get('initiator') === '1' };
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('conv');
    url.searchParams.delete('call');
    url.searchParams.delete('initiator');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [searchParams]);

  useEffect(() => {
    const pending = pendingMatchCallRef.current;
    if (!pending || selectedId !== pending.conv) return;
    pendingMatchCallRef.current = null;
    if (pending.initiator && callState === 'idle') {
      startCall(pending.conv, 'video');
    }
  }, [selectedId, callState, startCall]);

  useEffect(() => {
    onUserOnline((payload) => {
      setOnlineUserIds((prev) => new Set(prev).add(payload.user_id));
    });
    onUserOffline((payload) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(payload.user_id);
        return next;
      });
    });
  }, [onUserOnline, onUserOffline]);

  const activeIndex = TABS.findIndex((t) => t.id === activeTab);

  const CONVERSATIONS_LOAD_CAP_MS = 500;

  // Apply conversations cache before paint when user becomes available (e.g. from provider's cache)
  useLayoutEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    const cached = getStoredConversationsCache(uid);
    if (cached !== null) {
      setConversations(cached);
      setConversationsLoading(false);
      if (!conversationsCache || conversationsCache.userId !== uid) {
        conversationsCache = { userId: uid, list: cached };
      }
    }
  }, [currentUser?.id]);

  // When there is no current user, clear loading so we never stick on "Loading connections..."
  useEffect(() => {
    if (currentUser) return;
    setConversationsLoading(false);
    setConversations([]);
  }, [currentUser]);

  // Load connections + chat in parallel; show cached list immediately on refresh so dashboard feels instant
  useEffect(() => {
    if (!currentUser) return;
    const userId = currentUser.id;
    const LOAD_TIMEOUT_MS = 15000;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let loadCapTimer: ReturnType<typeof setTimeout> | null = null;

    const buildSelfRow = (id: string): ConversationItem => ({
      id,
      name: 'You',
      avatar_url: currentUser.avatar_url ?? null,
      lastMessage: null,
      lastSeenAt: new Date().toISOString(),
      isFavorite: false,
      unreadCount: 0,
      isOnline: true,
      isBlocked: false,
      otherUserId: null,
      lastMessageContentType: 'text',
      lastMessageSenderId: null,
    });
    const connectionToRow = (conn: Connection): ConversationItem => ({
      id: `${CONNECTION_PLACEHOLDER_PREFIX}${conn.id}`,
      name: conn.username ?? 'User',
      avatar_url: conn.avatar_url ?? null,
      lastMessage: null,
      lastSeenAt: null,
      isFavorite: false,
      unreadCount: 0,
      isOnline: false,
      isBlocked: false,
      otherUserId: conn.id,
      lastMessageContentType: 'text',
      lastMessageSenderId: null,
    });
    const mergeConversationsIntoConnectionList = (
      connectionList: ConversationItem[],
      selfId: string,
      apiList: ConversationItem[],
      youFromApi: ConversationItem | undefined
    ): ConversationItem[] => {
      const youRow = youFromApi
        ? { ...youFromApi, avatar_url: currentUser.avatar_url ?? youFromApi.avatar_url, name: 'You' as const }
        : buildSelfRow(selfId);
      const restConnectionRows = connectionList.filter((c) => c.name !== 'You');
      const byOtherUserId = new Map<string, ConversationItem>();
      for (const c of apiList) {
        if (c.name === 'You' || !c.otherUserId) continue;
        byOtherUserId.set(c.otherUserId, c);
      }
      const mergedRest = restConnectionRows.map((row) => {
        const otherId = row.otherUserId;
        const fromApi = otherId ? byOtherUserId.get(otherId) : null;
        return fromApi ?? row;
      });
      return [youRow, ...mergedRest];
    };

    const fromMemory = conversationsCache?.userId === userId && conversationsCache.list.length > 0;
    const fromStorage = getStoredConversationsCache(userId);
    if (fromMemory) {
      setConversations(conversationsCache!.list);
      setConversationsLoading(false);
    } else if (fromStorage) {
      setConversations(fromStorage);
      setConversationsLoading(false);
      conversationsCache = { userId, list: fromStorage };
    } else {
      const selfRowOnly = [buildSelfRow(SELF_PLACEHOLDER_ID)];
      setConversations(selfRowOnly);
      setConversationsLoading(false);
      conversationsCache = { userId, list: selfRowOnly };
    }

    // Timeout fallback so we never stick on loading if API/auth hangs
    loadTimeout = setTimeout(() => {
      loadTimeout = null;
      if (cancelled) return;
      setConversationsLoading(false);
    }, LOAD_TIMEOUT_MS);

    const connectionsPromise = getConnections();
    connectionsPromise
      .then((connections) => {
        if (cancelled) return;
        const selfRow = buildSelfRow(SELF_PLACEHOLDER_ID);
        const connectionRows = connections.map(connectionToRow);
        const initialList = [selfRow, ...connectionRows];
        setConversations(initialList);
        setConversationsLoading(false);
        if (loadCapTimer) {
          clearTimeout(loadCapTimer);
          loadCapTimer = null;
        }
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
        conversationsCache = { userId, list: initialList };
        setStoredConversationsCache(userId, initialList);
      })
      .catch(() => { /* keep spinner or 500ms cap; merge will run when allSettled completes */ });

    Promise.allSettled([connectionsPromise, chat.getSelfConversation(), chat.getConversations()]).then(([connRes, selfRes, listRes]) => {
      if (cancelled) return;
      if (loadCapTimer) {
        clearTimeout(loadCapTimer);
        loadCapTimer = null;
      }
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }
      const connections = connRes.status === 'fulfilled' ? connRes.value : [];
      const selfConv = selfRes.status === 'fulfilled' ? selfRes.value : null;
      const list = listRes.status === 'fulfilled' ? listRes.value : [];
      const selfRow = buildSelfRow(SELF_PLACEHOLDER_ID);
      const connectionRows = connections.map(connectionToRow);
      const initialList = [selfRow, ...connectionRows];
      const fromApi = Array.isArray(list) ? (list as ConversationItem[]) : [];
      const youFromApi = fromApi.find((c) => c.name === 'You');
      const selfId = selfConv?.id ?? SELF_PLACEHOLDER_ID;
      const merged = mergeConversationsIntoConnectionList(initialList, selfId, fromApi, youFromApi);
      setConversations(merged);
      conversationsCache = { userId, list: merged };
      setStoredConversationsCache(userId, merged);
      setConversationsLoading(false);
      // Preload messages for the likely-selected conversation (from sessionStorage) so they're ready when selectedId is restored
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY_SELECTED_ID);
        if (
          stored &&
          stored !== SELF_PLACEHOLDER_ID &&
          !stored.startsWith(CONNECTION_PLACEHOLDER_PREFIX) &&
          merged.some((c: { id: string }) => c.id === stored)
        ) {
          chat.getMessages(stored).then((list) => {
            messagesCacheRef.current[stored] = list as ChatMessage[];
          }).catch(() => { });
        }
      } catch {
        // ignore storage errors
      }
    });

    return () => {
      cancelled = true;
      if (loadCapTimer) clearTimeout(loadCapTimer);
      if (loadTimeout) clearTimeout(loadTimeout);
    };
  }, [currentUser?.id]);

  // Persist selected conversation so it survives HMR/remounts; only persist for Whispers (never persist group conversation_id for cross-tab confusion)
  useEffect(() => {
    if (!selectedId || activeTab !== 'Whispers') return;
    const isGroupConv = groups.some((g) => g.conversation_id === selectedId);
    if (isGroupConv) return;
    try {
      sessionStorage.setItem(STORAGE_KEY_SELECTED_ID, selectedId);
    } catch {
      // ignore storage errors
    }
  }, [selectedId, activeTab, groups]);

  // Join all conversation rooms (whispers + groups) so message:received is delivered instantly regardless of selected chat.
  // Re-run when wsConnected becomes true so we join rooms after the socket is ready.
  useEffect(() => {
    if (!currentUser?.id || !wsConnected) return;
    const roomIds = new Set<string>();
    for (const c of conversations) {
      if (c.id === SELF_PLACEHOLDER_ID) continue;
      if (c.id.startsWith(CONNECTION_PLACEHOLDER_PREFIX) && c.otherUserId) {
        roomIds.add(getWhisperConversationId(currentUser.id, c.otherUserId));
      } else if (c.id.startsWith('whisper_') || CONVERSATION_UUID_REGEX.test(c.id)) {
        roomIds.add(c.id);
      }
    }
    for (const g of groups) {
      if (g.conversation_id) roomIds.add(g.conversation_id);
    }
    roomIds.forEach((roomId) => joinConversation(roomId, currentUser.id));
  }, [conversations, groups, currentUser?.id, joinConversation, wsConnected]);

  // Load call logs when Archive tab is selected
  useEffect(() => {
    if (activeTab !== 'Archive' || !currentUser?.id) return;
    setArchiveCallLogsLoading(true);
    chat
      .getCallLogs(100, 0)
      .then((logs) => {
        setCallLogs(logs);
      })
      .catch(() => setCallLogs([]))
      .finally(() => setArchiveCallLogsLoading(false));
  }, [activeTab, currentUser?.id]);

  // Load groups and pending invites when Group tab is selected
  useEffect(() => {
    if (activeTab !== 'Group' || !currentUser?.id) return;
    setGroupsLoading(true);
    Promise.all([groupsApi.getGroups(), groupsApi.getPendingInvites()])
      .then(([list, invites]) => {
        setGroups(list);
        setPendingGroupInvites(Array.isArray(invites) ? invites : []);
      })
      .catch(() => {
        setGroups([]);
        setPendingGroupInvites([]);
      })
      .finally(() => setGroupsLoading(false));
  }, [activeTab, currentUser?.id]);

  // Refetch when switching to Whispers and list is empty; connections first, then optional conversation merge
  useEffect(() => {
    if (activeTab !== 'Whispers' || !currentUser?.id || conversations.length > 0) return;
    setConversationsLoading(true);
    const selfRow: ConversationItem = { id: SELF_PLACEHOLDER_ID, name: 'You', avatar_url: currentUser.avatar_url ?? null, lastMessage: null, lastSeenAt: new Date().toISOString(), isFavorite: false, unreadCount: 0, isOnline: true, isBlocked: false, otherUserId: null, lastMessageContentType: 'text', lastMessageSenderId: null };
    const connectionToRow = (conn: Connection): ConversationItem => ({
      id: `${CONNECTION_PLACEHOLDER_PREFIX}${conn.id}`,
      name: conn.username ?? 'User',
      avatar_url: conn.avatar_url ?? null,
      lastMessage: null,
      lastSeenAt: null,
      isFavorite: false,
      unreadCount: 0,
      isOnline: false,
      isBlocked: false,
      otherUserId: conn.id,
      lastMessageContentType: 'text',
      lastMessageSenderId: null,
    });
    const setFromConnections = (conns: Connection[]) => {
      const list = [selfRow, ...conns.map(connectionToRow)];
      setConversations(list);
    };

    getConnections()
      .then((conns) => {
        setFromConnections(conns);
        setConversationsLoading(false);
        return Promise.all([chat.getSelfConversation(), chat.getConversations()]).then(([selfConv, list]) => {
          const fromApi = Array.isArray(list) ? (list as ConversationItem[]) : [];
          const youFromApi = fromApi.find((c) => c.name === 'You');
          const selfId = selfConv?.id ?? SELF_PLACEHOLDER_ID;
          const youRow = youFromApi ? { ...youFromApi, avatar_url: currentUser?.avatar_url ?? youFromApi.avatar_url, name: 'You' as const } : { ...selfRow, id: selfId };
          const byOtherUserId = new Map<string, ConversationItem>();
          for (const c of fromApi) {
            if (c.name !== 'You' && c.otherUserId) byOtherUserId.set(c.otherUserId, c);
          }
          const mergedRest = conns.map((conn) => byOtherUserId.get(conn.id) ?? connectionToRow(conn));
          setConversations([youRow, ...mergedRest]);
        }).catch(() => { /* keep list from connections */ });
      })
      .catch(() => {
        setConversations([selfRow]);
        setConversationsLoading(false);
      });
  }, [activeTab, currentUser?.id, conversations.length]);

  const refetchConversationsList = useCallback(() => {
    if (!currentUser?.id) return;
    setConversationsLoading(true);
    const buildSelfRow = (id: string): ConversationItem => ({
      id,
      name: 'You',
      avatar_url: currentUser.avatar_url ?? null,
      lastMessage: null,
      lastSeenAt: new Date().toISOString(),
      isFavorite: false,
      unreadCount: 0,
      isOnline: true,
      isBlocked: false,
      otherUserId: null,
      lastMessageContentType: 'text',
      lastMessageSenderId: null,
    });
    const connectionToRow = (conn: Connection): ConversationItem => ({
      id: `${CONNECTION_PLACEHOLDER_PREFIX}${conn.id}`,
      name: conn.username ?? 'User',
      avatar_url: conn.avatar_url ?? null,
      lastMessage: null,
      lastSeenAt: null,
      isFavorite: false,
      unreadCount: 0,
      isOnline: false,
      isBlocked: false,
      otherUserId: conn.id,
      lastMessageContentType: 'text',
      lastMessageSenderId: null,
    });
    const mergeConversationsIntoConnectionList = (
      connectionList: ConversationItem[],
      selfId: string,
      apiList: ConversationItem[],
      youFromApi: ConversationItem | undefined
    ): ConversationItem[] => {
      const youRow = youFromApi
        ? { ...youFromApi, avatar_url: currentUser.avatar_url ?? youFromApi.avatar_url, name: 'You' as const }
        : buildSelfRow(selfId);
      const restConnectionRows = connectionList.filter((c) => c.name !== 'You');
      const byOtherUserId = new Map<string, ConversationItem>();
      for (const c of apiList) {
        if (c.name === 'You' || !c.otherUserId) continue;
        byOtherUserId.set(c.otherUserId, c);
      }
      const mergedRest = restConnectionRows.map((row) => {
        const otherId = row.otherUserId;
        const fromApi = otherId ? byOtherUserId.get(otherId) : null;
        return fromApi ?? row;
      });
      return [youRow, ...mergedRest];
    };
    Promise.allSettled([getConnections(), chat.getSelfConversation(), chat.getConversations()]).then(([connRes, selfRes, listRes]) => {
      const connections = connRes.status === 'fulfilled' ? connRes.value : [];
      const selfConv = selfRes.status === 'fulfilled' ? selfRes.value : null;
      const list = listRes.status === 'fulfilled' ? listRes.value : [];
      const selfRow = buildSelfRow(SELF_PLACEHOLDER_ID);
      const connectionRows = connections.map(connectionToRow);
      const initialList = [selfRow, ...connectionRows];
      const fromApi = Array.isArray(list) ? (list as ConversationItem[]) : [];
      const youFromApi = fromApi.find((c) => c.name === 'You');
      const selfId = selfConv?.id ?? SELF_PLACEHOLDER_ID;
      const merged = mergeConversationsIntoConnectionList(initialList, selfId, fromApi, youFromApi);
      setConversations(merged);
      conversationsCache = { userId: currentUser.id, list: merged };
      setStoredConversationsCache(currentUser.id, merged);
    }).finally(() => setConversationsLoading(false));
  }, [currentUser?.id]);

  const refetchGroupsList = useCallback(() => {
    if (!currentUser?.id) return;
    setGroupsLoading(true);
    Promise.all([groupsApi.getGroups(), groupsApi.getPendingInvites()])
      .then(([list, invites]) => {
        setGroups(list);
        setPendingGroupInvites(Array.isArray(invites) ? invites : []);
      })
      .catch(() => {
        setGroups([]);
        setPendingGroupInvites([]);
      })
      .finally(() => setGroupsLoading(false));
  }, [currentUser?.id]);

  // When a group is selected, fetch its details to enforce view-only (disable send for non-admins when view_only_mode is on)
  useEffect(() => {
    if (!selectedGroupId || !currentUser?.id) {
      setGroupViewOnly(false);
      setGroupAmAdmin(true);
      return;
    }
    groupsApi
      .getGroup(selectedGroupId)
      .then((g) => {
        if (!g) {
          setGroupViewOnly(false);
          setGroupAmAdmin(true);
          return;
        }
        setGroupViewOnly(g.view_only_mode);
        const me = g.members.find((m) => m.user_id === currentUser.id);
        setGroupAmAdmin(me?.role === 'creator' || me?.role === 'admin');
      })
      .catch(() => {
        setGroupViewOnly(false);
        setGroupAmAdmin(true);
      });
  }, [selectedGroupId, currentUser?.id]);

  // Restore selected conversation from sessionStorage after conversations load so messages don't vanish on code change/HMR.
  // On mobile/tablet (≤1024px) do not restore so Whispers opens with the list first.
  useEffect(() => {
    if (!currentUser?.id || selectedId !== null) return;
    if (typeof window !== 'undefined' && window.innerWidth <= 1024) return;
    if (activeTab === 'Group' ? groups.length === 0 : conversations.length === 0) return;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_SELECTED_ID);
      if (!stored) return;
      // When Group tab is active, only restore if the stored id is a group conversation (not a whisper)
      if (activeTab === 'Group') {
        const groupMatch = groups.find((g) => g.conversation_id === stored);
        if (groupMatch) {
          setSelectedId(stored);
          setSelectedGroupId(groupMatch.id);
          return;
        }
        return;
      }
      const inList = conversations.some((c) => c.id === stored);
      const youRow = conversations.find((c) => c.name === 'You');
      const isStoredYou = stored === SELF_PLACEHOLDER_ID && youRow;
      if (inList) {
        setSelectedId(stored);
      } else if (isStoredYou) {
        setSelectedId(youRow!.id);
      }
    } catch {
      // ignore
    }
  }, [conversations, currentUser?.id, selectedId, activeTab, groups]);

  // When a connection placeholder is selected, get-or-create the real conversation and switch to it
  useEffect(() => {
    if (!selectedId?.startsWith(CONNECTION_PLACEHOLDER_PREFIX)) return;
    const otherUserId = selectedId.slice(CONNECTION_PLACEHOLDER_PREFIX.length);
    if (!otherUserId || !currentUser?.id) return;
    let cancelled = false;
    chat.getOrCreateConversationWithUser(otherUserId).then((conv) => {
      if (cancelled || !conv) return;
      const realItem: ConversationItem = {
        id: conv.id,
        name: conv.name,
        avatar_url: conv.avatar_url,
        lastMessage: null,
        lastSeenAt: null,
        isFavorite: false,
        unreadCount: 0,
        isOnline: false,
        isBlocked: false,
        otherUserId: conv.otherUserId,
        lastMessageContentType: 'text',
        lastMessageSenderId: null,
      };
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? realItem : c))
      );
      setSelectedId(conv.id);
    }).catch(() => {
      if (!cancelled) setMessagesLoadError('Could not start conversation. The chat service may not support creating conversations yet.');
    });
    return () => { cancelled = true; };
  }, [selectedId, currentUser?.id]);

  // When "You" is selected with placeholder id, resolve to real conversation id first (retry on failure)
  useEffect(() => {
    if (selectedId !== SELF_PLACEHOLDER_ID || !currentUser?.id) return;
    let cancelled = false;
    const tryResolve = (attempt = 0) => {
      const maxAttempts = 3;
      chat.getSelfConversation().then((selfConv) => {
        if (cancelled) return;
        if (selfConv) {
          setConversations((prev) =>
            prev.map((c) => (c.id === SELF_PLACEHOLDER_ID ? { ...c, id: selfConv.id } : c))
          );
          setSelectedId(selfConv.id);
          return;
        }
        if (attempt < maxAttempts - 1) {
          setTimeout(() => tryResolve(attempt + 1), 400 * (attempt + 1));
        }
      }).catch(() => {
        if (!cancelled && attempt < maxAttempts - 1) {
          setTimeout(() => tryResolve(attempt + 1), 400 * (attempt + 1));
        }
      });
    };
    tryResolve();
    return () => {
      cancelled = true;
    };
  }, [selectedId, currentUser?.id]);

  // Load messages and join conversation when selection changes (skip placeholder and blocked)
  const selectedConv = conversations.find((c) => c.id === selectedId);
  const isSelectedBlocked = !!selectedConv?.isBlocked;
  const isConnectionPlaceholder = !!selectedId?.startsWith(CONNECTION_PLACEHOLDER_PREFIX);
  const isSelfSelected = selectedId === SELF_PLACEHOLDER_ID;
  /** Enable bar when a real conversation is selected; disable for "You", connection placeholder, blocked, or group view-only. */
  const groupViewOnlyBlocksSend = activeTab === 'Group' && !!selectedGroupId && groupViewOnly && !groupAmAdmin;
  const canSend = !!selectedId && !isSelfSelected && !isConnectionPlaceholder && !isSelectedBlocked && !groupViewOnlyBlocksSend;

  /** Resolve to real conversation id (for "You" placeholder we fetch self-conversation id at send time; connection placeholders are invalid for send until resolved). */
  const getEffectiveConversationId = useCallback(async (sid: string | null) => {
    if (!sid) return null;
    if (sid.startsWith(CONNECTION_PLACEHOLDER_PREFIX)) return null;
    if (sid !== SELF_PLACEHOLDER_ID) return sid;
    try {
      const self = await chat.getSelfConversation();
      return self?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  /** Sync room id for typing events: use real whisper/group id so backend emits to the room the receiver joined. */
  const getTypingRoomId = useCallback((sid: string | null): string | null => {
    if (!sid || !currentUser?.id) return null;
    if (sid === SELF_PLACEHOLDER_ID) return null;
    if (sid.startsWith(CONNECTION_PLACEHOLDER_PREFIX)) {
      const otherId = sid.slice(CONNECTION_PLACEHOLDER_PREFIX.length);
      return getWhisperConversationId(currentUser.id, otherId);
    }
    if (sid.startsWith('whisper_') || CONVERSATION_UUID_REGEX.test(sid)) return sid;
    return null;
  }, [currentUser?.id]);

  /** True when an incoming event (message:received, typing:indicator) is for the currently selected conversation. Handles placeholder selectedId. */
  const isEventForSelectedConversation = useCallback(
    (eventConversationId: string, selectedId: string | null): boolean => {
      if (selectedId == null) return false;
      if (eventConversationId === selectedId) return true;
      if (selectedId.startsWith(CONNECTION_PLACEHOLDER_PREFIX) && currentUser?.id) {
        const otherId = selectedId.slice(CONNECTION_PLACEHOLDER_PREFIX.length);
        return eventConversationId === getWhisperConversationId(currentUser.id, otherId);
      }
      return false;
    },
    [currentUser?.id]
  );

  const loadMessagesForSelected = useCallback(() => {
    if (!selectedId || selectedId === SELF_PLACEHOLDER_ID || !currentUser?.id) return;
    setMessagesLoadError(null);
    delete messagesCacheRef.current[selectedId];
    chat
      .getMessages(selectedId)
      .then((list) => {
        const arr = list as ChatMessage[];
        messagesCacheRef.current[selectedId] = arr;
        setMessages(arr);
        setMessagesLoadError(null);
      })
      .catch((err: Error) => {
        const msg = err?.message ?? 'Couldn\'t load messages';
        setMessagesLoadError(msg.includes('fetch') || msg.includes('Failed to fetch') ? 'Chat service unavailable. Start the chat-service (e.g. port 3004 or 4002) and retry.' : msg);
        setMessages([]);
      });
  }, [selectedId, currentUser?.id]);

  const selectedGroupConvId = selectedGroupId ? groups.find((g) => g.id === selectedGroupId)?.conversation_id : null;
  useEffect(() => {
    if (activeTab === 'Group' && !selectedGroupId) {
      setMessages([]);
      setCallLogsInConversation([]);
      setMessagesLoadError(null);
      setMessagesLoading(false);
      return;
    }
    if (activeTab === 'Group' && selectedGroupId && selectedId !== selectedGroupConvId) {
      setMessages([]);
      setCallLogsInConversation([]);
      setMessagesLoadError(null);
      setMessagesLoading(false);
      return;
    }
    if (activeTab !== 'Group' && selectedId && groups.some((g) => g.conversation_id === selectedId)) {
      setMessages([]);
      setCallLogsInConversation([]);
      setMessagesLoadError(null);
      setMessagesLoading(false);
      return;
    }
    if (!selectedId || selectedId === SELF_PLACEHOLDER_ID || !currentUser?.id) {
      if (!selectedId || selectedId === SELF_PLACEHOLDER_ID) {
        setMessages([]);
        setCallLogsInConversation([]);
        setMessagesLoadError(null);
        setMessagesLoading(false);
      }
      return;
    }
    if (selectedId.startsWith(CONNECTION_PLACEHOLDER_PREFIX)) {
      setMessages([]);
      setCallLogsInConversation([]);
      setMessagesLoadError(null);
      setMessagesLoading(false);
      return;
    }
    if (selectedConv?.isBlocked) {
      setMessages([]);
      setCallLogsInConversation([]);
      setMessagesLoadError(null);
      setMessagesLoading(false);
      return;
    }
    let cancelled = false;
    setMessagesLoadError(null);
    const cached = messagesCacheRef.current[selectedId];
    if (cached !== undefined) {
      setMessages(cached);
      setMessagesLoading(false);
    } else {
      setMessagesLoading(true);
    }
    const messagesPromise = chat
      .getMessages(selectedId)
      .then((list) => {
        const arr = list as ChatMessage[];
        messagesCacheRef.current[selectedId] = arr;
        if (!cancelled) {
          setMessages(arr);
          setMessagesLoadError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const msg = err?.message ?? 'Couldn\'t load messages';
          setMessagesLoadError(msg.includes('fetch') || msg.includes('Failed to fetch') ? 'Chat service unavailable. Start the chat-service (e.g. port 3004 or 4002) and retry.' : msg);
          setMessages([]);
        }
      });
    const callLogsPromise = chat
      .getCallLogsForConversation(selectedId, 100, 0)
      .then((logs) => {
        if (!cancelled) setCallLogsInConversation(logs);
      })
      .catch(() => {
        if (!cancelled) setCallLogsInConversation([]);
      });
    Promise.allSettled([messagesPromise, callLogsPromise]).then(() => {
      if (!cancelled) setMessagesLoading(false);
    });
    joinConversation(selectedId, currentUser.id);
    return () => {
      cancelled = true;
      // Do not leave room on switch; we stay in all rooms for real-time delivery
    };
  }, [activeTab, selectedGroupId, selectedGroupConvId, selectedId, currentUser?.id, joinConversation, selectedConv?.isBlocked, groups]);

  // Subscribe to incoming messages when WebSocket is connected so the receiver gets message:received
  useEffect(() => {
    if (!wsConnected) return;
    const handler = (msg: {
      conversation_id: string;
      id: string;
      sender_id: string;
      content: string;
      content_type: string;
      created_at: string;
      delivered_at?: string | null;
      read_at?: string | null;
      sender_username?: string | null;
      reply_to_message_id?: string;
      reply_to_content?: string;
      reply_to_sender_id?: string;
      reply_to_sender_username?: string;
    }) => {
      delete messagesCacheRef.current[msg.conversation_id];

      const otherUserIdFromConv =
        msg.conversation_id.startsWith('whisper_') && currentUser?.id
          ? (() => {
            const parts = msg.conversation_id.split('_');
            if (parts.length !== 3) return null;
            const a = parts[1];
            const b = parts[2];
            return a === currentUser.id ? b : b === currentUser.id ? a : null;
          })()
          : null;
      const isForSelected = isEventForSelectedConversation(msg.conversation_id, selectedIdRef.current);
      const isFromOther = msg.sender_id !== currentUser?.id;
      let countedSet = unreadCountedIdsRef.current.get(msg.conversation_id);
      if (!countedSet) {
        countedSet = new Set<string>();
        unreadCountedIdsRef.current.set(msg.conversation_id, countedSet);
      }
      const alreadyCounted = countedSet.has(msg.id);
      if (isFromOther && !alreadyCounted) countedSet.add(msg.id);
      const shouldIncrementUnread = isFromOther && !isForSelected && !alreadyCounted;
      const baseUpdate = { lastMessage: msg.content, lastSeenAt: msg.created_at, lastMessageContentType: (msg.content_type === 'image' || msg.content_type === 'audio' ? msg.content_type : 'text') as 'text' | 'image' | 'audio', lastMessageSenderId: msg.sender_id };
      setConversations((prev) =>
        prev.map((c) => {
          const isMatch = c.id === msg.conversation_id || (!!otherUserIdFromConv && c.otherUserId === otherUserIdFromConv);
          if (!isMatch) return c;
          const unreadCount = isForSelected ? 0 : shouldIncrementUnread ? (c.unreadCount ?? 0) + 1 : (c.unreadCount ?? 0);
          return { ...c, ...baseUpdate, unreadCount };
        })
      );
      if (CONVERSATION_UUID_REGEX.test(msg.conversation_id)) {
        const isGroupSelected = selectedIdRef.current === msg.conversation_id;
        if (!isGroupSelected && isFromOther && !alreadyCounted) {
          setGroups((prev) =>
            prev.map((g) =>
              g.conversation_id === msg.conversation_id ? { ...g, unreadCount: (g.unreadCount ?? 0) + 1 } : g
            )
          );
        }
      }
      if (!isForSelected) return;
      const chatMsg: ChatMessage = {
        id: msg.id,
        sender_id: msg.sender_id,
        content: msg.content,
        content_type: msg.content_type as 'text' | 'image' | 'audio',
        created_at: msg.created_at,
        delivered_at: msg.delivered_at ?? undefined,
        read_at: msg.read_at ?? undefined,
        sender_username: msg.sender_username ?? undefined,
        reply_to_message_id: msg.reply_to_message_id,
        reply_to_content: msg.reply_to_content,
        reply_to_sender_id: msg.reply_to_sender_id,
        reply_to_sender_username: msg.reply_to_sender_username,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === chatMsg.id)) return prev;
        const isFromMe = msg.sender_id === currentUser?.id;
        if (isFromMe) {
          const withoutTemp = prev.filter((m) => !m.id.startsWith('temp-'));
          return [...withoutTemp, chatMsg];
        }
        return [...prev, chatMsg];
      });
      setMessageSelectionMode(false);
      setSelectedMessageIds(new Set());
      // Refetch to get delivered_at/read_at; merge with current state so we don't lose the message if refetch returns before DB has it
      chat.getMessages(msg.conversation_id).then((list) => {
        const arr = list as ChatMessage[];
        setMessages((prev) => {
          const byId = new Map<string, ChatMessage>();
          prev.forEach((m) => byId.set(m.id, m));
          arr.forEach((m) => byId.set(m.id, m));
          return Array.from(byId.values()).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
        messagesCacheRef.current[msg.conversation_id] = arr;
      }).catch(() => { });
    };
    onMessageReceived(handler);
    return () => {
      offMessageReceived(handler);
    };
  }, [wsConnected, onMessageReceived, offMessageReceived, currentUser?.id, isEventForSelectedConversation]);

  useLayoutEffect(() => {
    const el = messagesScrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, [messages]);

  const scrollToMessageId = useCallback((messageId: string) => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    const el = messagesListWrapRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      highlightTimeoutRef.current = setTimeout(() => {
        highlightTimeoutRef.current = null;
        setHighlightedMessageId(null);
      }, 2500);
    }
  }, []);

  useEffect(() => () => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
  }, []);

  useEffect(() => {
    setReplyingTo(null);
  }, [selectedId]);

  useEffect(() => {
    onConversationRead((payload) => {
      if (payload.conversation_id === selectedIdRef.current) {
        chat.getMessages(payload.conversation_id).then((list) => setMessages(list as ChatMessage[])).catch(() => { });
      }
    });
  }, [onConversationRead]);

  useEffect(() => {
    onTypingIndicator((payload) => {
      if (payload.user_id === currentUser?.id) return;
      if (payload.conversation_id != null && !isEventForSelectedConversation(payload.conversation_id, selectedIdRef.current)) return;
      setOtherUserTyping(payload.typing);
    });
  }, [onTypingIndicator, currentUser?.id, isEventForSelectedConversation]);

  useEffect(() => {
    const handler = (payload: { conversation_id: string; message_ids: string[] }) => {
      if (!isEventForSelectedConversation(payload.conversation_id, selectedIdRef.current)) return;
      const ids = new Set(payload.message_ids ?? []);
      if (ids.size > 0) {
        setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
      }
      chat.getMessages(payload.conversation_id).then((list) => setMessages(list as ChatMessage[])).catch(() => { });
    };
    onMessageDeleted(handler);
  }, [onMessageDeleted, isEventForSelectedConversation]);

  // Close message selection mode when clicking/tapping outside the dropdown and Select All bar
  useEffect(() => {
    if (!messageSelectionMode) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (target && document.body.contains(target)) {
        const kept = (e.target as Element).closest?.('[data-keep-selection-open]');
        if (kept) return;
        setMessageSelectionMode(false);
        setSelectedMessageIds(new Set());
      }
    };
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('touchstart', handlePointer, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('touchstart', handlePointer, true);
    };
  }, [messageSelectionMode]);

  // Close connection selection mode when clicking/tapping outside the connection list
  useEffect(() => {
    if (!connectionSelectionMode) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (target && document.body.contains(target)) {
        const kept = (e.target as Element).closest?.('[data-keep-connection-selection-open]');
        if (kept) return;
        setConnectionSelectionMode(false);
        setSelectedConversationIds(new Set());
      }
    };
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('touchstart', handlePointer, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('touchstart', handlePointer, true);
    };
  }, [connectionSelectionMode]);

  // Close call log selection mode when clicking/tapping outside the Select All bar and call log rows
  useEffect(() => {
    if (!callLogSelectionMode) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (target && document.body.contains(target)) {
        const kept = (e.target as Element).closest?.('[data-keep-call-log-selection-open]');
        if (kept) return;
        setCallLogSelectionMode(false);
        setSelectedCallLogIds(new Set());
      }
    };
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('touchstart', handlePointer, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('touchstart', handlePointer, true);
    };
  }, [callLogSelectionMode]);

  const notifyTypingStart = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      const sid = selectedIdRef.current;
      const roomId = getTypingRoomId(sid);
      if (roomId && currentUser?.id) startTyping(roomId, currentUser.id);
      typingTimeoutRef.current = null;
    }, 300);
  };

  const notifyTypingStop = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    const sid = selectedIdRef.current;
    const roomId = getTypingRoomId(sid);
    if (roomId && currentUser?.id) stopTyping(roomId, currentUser.id);
  };

  const handleSendText = async () => {
    const text = inputValue.trim();
    if (!text || !canSend || !currentUser?.id) return;
    const convId = await getEffectiveConversationId(selectedId);
    if (!convId) {
      setMessagesLoadError('Could not load conversation. Try again.');
      return;
    }
    setMessagesLoadError(null);
    const tempId = `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      sender_id: currentUser.id,
      content: text,
      content_type: 'text',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, lastMessage: text, lastSeenAt: optimistic.created_at, lastMessageContentType: 'text', lastMessageSenderId: currentUser.id } : c)));
    setMessageSelectionMode(false);
    setSelectedMessageIds(new Set());
    const replyOpts = replyingTo
      ? {
        reply_to_message_id: replyingTo.id,
        reply_to_content: replyingTo.content_type === 'text' ? replyingTo.content.slice(0, 200) : (replyingTo.content_type === 'image' ? 'Photo' : 'Audio'),
        reply_to_sender_id: replyingTo.sender_id,
        reply_to_sender_username: replyingTo.sender_username ?? undefined,
      }
      : undefined;
    setReplyingTo(null);
    setInputValue('');
    notifyTypingStop();
    try {
      const serverMsg = await chat.sendMessage(convId, text, { content_type: 'text', ...replyOpts });
      if (serverMsg) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...serverMsg, content_type: serverMsg.content_type as 'text' | 'image' | 'audio' } : m)));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setMessagesLoadError(null);
        loadMessagesForSelected();
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setMessagesLoadError(null);
      loadMessagesForSelected();
    }
  };

  const handleAttachImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canSend || !currentUser?.id) return;
    if (!file.type.startsWith('image/')) return;
    const convId = await getEffectiveConversationId(selectedId);
    if (!convId) {
      setMessagesLoadError('Could not load conversation. Try again.');
      e.target.value = '';
      return;
    }
    setMessagesLoadError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const tempId = `temp-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        sender_id: currentUser.id,
        content: dataUrl,
        content_type: 'image',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, lastMessage: 'Photo', lastSeenAt: optimistic.created_at, lastMessageContentType: 'image', lastMessageSenderId: currentUser.id } : c)));
      setMessageSelectionMode(false);
      setSelectedMessageIds(new Set());
      const replyOpts = replyingTo
        ? {
          reply_to_message_id: replyingTo.id,
          reply_to_content: 'Photo',
          reply_to_sender_id: replyingTo.sender_id,
          reply_to_sender_username: replyingTo.sender_username ?? undefined,
        }
        : undefined;
      setReplyingTo(null);
      try {
        const serverMsg = await chat.sendMessage(convId, dataUrl, { content_type: 'image', ...replyOpts });
        if (serverMsg) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...serverMsg, content_type: 'image' as const } : m)));
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setMessagesLoadError(null);
          loadMessagesForSelected();
        }
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setMessagesLoadError(null);
        loadMessagesForSelected();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleToggleRecordAudio = async () => {
    if (!canSend || !currentUser?.id) return;
    if (isRecording) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      const recordingConvId = selectedId;
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          getEffectiveConversationId(recordingConvId).then(async (convId) => {
            if (!convId || !currentUser?.id) return;
            const tempId = `temp-${Date.now()}`;
            const optimistic: ChatMessage = {
              id: tempId,
              sender_id: currentUser.id,
              content: dataUrl,
              content_type: 'audio',
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, optimistic]);
            setConversations((prev) => prev.map((c) => (c.id === recordingConvId ? { ...c, lastMessage: 'Audio', lastSeenAt: optimistic.created_at, lastMessageContentType: 'audio', lastMessageSenderId: currentUser.id } : c)));
            setMessageSelectionMode(false);
            setSelectedMessageIds(new Set());
            try {
              const serverMsg = await chat.sendMessage(convId, dataUrl, { content_type: 'audio' });
              if (serverMsg) {
                setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...serverMsg, content_type: 'audio' as const } : m)));
              } else {
                setMessages((prev) => prev.filter((m) => m.id !== tempId));
                setMessagesLoadError(null);
                loadMessagesForSelected();
              }
            } catch {
              setMessages((prev) => prev.filter((m) => m.id !== tempId));
              setMessagesLoadError(null);
              loadMessagesForSelected();
            }
          });
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const handleStarClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const item = conversations.find((c) => c.id === id);
    const newFavorite = item ? !item.isFavorite : false;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, isFavorite: newFavorite } : c)));
    if (item && id !== SELF_PLACEHOLDER_ID) chat.setFavorite(id, newFavorite).catch(() => { });
  };

  const handleRowClick = (item: ConversationItem) => {
    setSelectedId(item.id);
    unreadCountedIdsRef.current.delete(item.id);
    if (item.id !== SELF_PLACEHOLDER_ID && !item.isBlocked) {
      chat.markRead(item.id).then(() => {
        if (currentUser?.id) emitConversationRead(item.id, currentUser.id);
      }).catch(() => { });
    }
    setConversations((prev) => prev.map((c) => (c.id === item.id ? { ...c, unreadCount: 0 } : c)));
  };

  const favoritesCount = conversations.filter((c) => c.isFavorite).length;
  const unreadConversationsCount = conversations.filter((c) => c.unreadCount > 0).length;
  const groupConversationIds = new Set(groups.map((g) => g.conversation_id));
  const whispersOnlyConversations = conversations.filter((c) => !groupConversationIds.has(c.id));
  const displayList =
    connectionFilter === 'favorites'
      ? whispersOnlyConversations.filter((c) => c.isFavorite)
      : connectionFilter === 'unread'
        ? whispersOnlyConversations.filter((c) => c.unreadCount > 0)
        : whispersOnlyConversations;

  const groupsUnreadCount = groups.filter((g) => g.unreadCount > 0).length;
  const groupsFavoritesCount = groups.filter((g) => g.isFavorite).length;
  const groupDisplayList =
    connectionFilter === 'favorites'
      ? groups.filter((g) => g.isFavorite)
      : connectionFilter === 'unread'
        ? groups.filter((g) => g.unreadCount > 0)
        : groups;

  const handleCreateGroup = useCallback(() => {
    const name = createGroupName.trim();
    if (!name || createGroupSubmitting) return;
    setCreateGroupSubmitting(true);
    groupsApi
      .createGroup(name)
      .then((result) => {
        if (!result) {
          setCreateGroupSubmitting(false);
          return;
        }
        const newGroup: GroupListItem = {
          id: result.id,
          conversation_id: result.conversation_id,
          name,
          avatar_url: null,
          unreadCount: 0,
          isFavorite: false,
          lastMessage: null,
          lastMessageAt: null,
          lastMessageSenderUsername: null,
        };
        setGroups((prev) => [newGroup, ...prev]);
        setSelectedGroupId(result.id);
        setSelectedId(result.conversation_id);
        setShowCreateGroupForm(false);
        setCreateGroupName('');
        setMessages([]);
        setMessagesLoadError(null);
        chat.getMessages(result.conversation_id).then((list) => setMessages(list as ChatMessage[])).catch((err: Error) => {
          setMessagesLoadError(err?.message ?? 'Couldn\'t load messages');
          setMessages([]);
        });
      })
      .catch(() => {
        setCreateGroupSubmitting(false);
      })
      .finally(() => {
        setCreateGroupSubmitting(false);
      });
  }, [createGroupName, createGroupSubmitting]);

  const handleTabClick = useCallback((tab: ChatTab) => {
    setActiveTab(tab);
    if (tab === 'Group') {
      setSelectedGroupId(null);
      setSelectedId(null);
    } else if (tab === 'Whispers') {
      setSelectedGroupId(null);
      setSelectedId((prev) => {
        if (!prev) return prev;
        const isGroupConversation = groups.some((g) => g.conversation_id === prev);
        return isGroupConversation ? null : prev;
      });
    }
  }, [groups]);

  const handlePillContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('[data-tab]') as HTMLElement | null;
      const tab = btn?.getAttribute('data-tab') as ChatTab | null;
      if (tab && (tab === 'Whispers' || tab === 'Group' || tab === 'Archive')) {
        e.preventDefault();
        handleTabClick(tab);
      }
    },
    [handleTabClick]
  );

  const isVideoCallActive = callState === 'active' && callType === 'video';
  const isVideoCallInProgress = callState !== 'idle' && callType === 'video';
  const isAudioCallActive = callState !== 'idle' && callType === 'audio';

  const isConversationOpen = (activeTab === 'Whispers' || activeTab === 'Group') && !!selectedId;
  const isCallActive = callState !== 'idle';

  /* On mobile/tablet: body class so layout can hide bottom bar when video call is active (full-screen video only) */
  useEffect(() => {
    if (isVideoCallActive) {
      document.body.classList.add('rendly-video-call-active');
    } else {
      document.body.classList.remove('rendly-video-call-active');
    }
    return () => document.body.classList.remove('rendly-video-call-active');
  }, [isVideoCallActive]);

  return (
    <ChatPageRoot className={[isVideoCallActive && 'chat-page--video-active', isVideoCallInProgress && 'chat-page--video-call-open', isAudioCallActive && 'chat-page--audio-active', isConversationOpen && 'chat-page--conversation-open', isCallActive && 'chat-page--call-active', groupSettingsOpen && 'chat-page--group-settings-open'].filter(Boolean).join(' ') || undefined}>
      <div className="chat-pill-wrapper">
        <div
          className="chat-pill-container"
          role="tablist"
          aria-label="Chat view"
          onClick={handlePillContainerClick}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls="chat-tabpanel"
              id={`chat-tab-${id}`}
              data-tab={id}
              className={`chat-pill-btn chat-pill-btn--${id === 'Group' ? 'group' : id === 'Whispers' ? 'whispers' : 'archive'} ${activeTab === id ? 'chat-pill-btn--active' : ''}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleTabClick(id);
                }
              }}
            >
              <span className="chat-pill-btn-icon-wrap">{TAB_ICONS[id]}</span>
              <span className="chat-pill-btn-inner">{label}</span>
            </button>
          ))}
          {/* Sliding indicator rendered after buttons so it never blocks clicks */}
          <div
            className="chat-pill-indicator"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
            aria-hidden
          />
        </div>
      </div>
      <section
        id="chat-tabpanel"
        role="tabpanel"
        className="chat-whispers-section"
        aria-label={activeTab === 'Whispers' ? 'Whispers' : activeTab === 'Group' ? 'Group' : 'Archive'}
      >
        <div
          className={`chat-whispers-section-content${activeTab === 'Archive' ? ' chat-whispers-section-content--archive' : ''}${activeTab === 'Group' ? ' chat-whispers-section-content--group' : ''}${isVideoCallActive ? ' chat-whispers-section-content--video-active' : ''}${isVideoCallActive && isResizingVideoPanel ? ' chat-whispers-section-content--resizing' : ''}${(activeTab === 'Whispers' || activeTab === 'Group') && selectedId ? ' chat-whispers-section-content--conversation-open' : ''}`}
          style={isVideoCallActive && !isMobileOrTablet ? { marginLeft: `${videoPanelWidthVw}vw` } : undefined}
        >
          <div className="chat-section-col chat-section-col--left">
            <div className="chat-left-scroll-subsection">
              <div className="chat-left-sticky-header">
                {activeTab === 'Archive' ? (
                  <div className="chat-archive-header">
                    <h2 className="chat-archive-title">Call history</h2>
                    <button
                      type="button"
                      className="chat-archive-clear-call-log-btn"
                      onClick={async () => {
                        const ids = Array.from(selectedCallLogIds);
                        if (ids.length === 0) return;
                        try {
                          const { deleted } = await chat.deleteCallLogs(ids);
                          setCallLogs((prev) => prev.filter((l) => !deleted.includes(l.id)));
                          setCallLogSelectionMode(false);
                          setSelectedCallLogIds(new Set());
                        } catch {
                          window.alert('Failed to delete call log(s). Please try again.');
                        }
                      }}
                      disabled={selectedCallLogIds.size === 0}
                      aria-label="Clear selected call log entries"
                      title={selectedCallLogIds.size === 0 ? 'Select call log entries below, then click to clear' : 'Clear selected call log entries'}
                    >
                      <ClearChatIcon />
                      <span>Clear Call Log</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <SearchConnections />
                    <div className="chat-left-header-row">
                      <div className="chat-filter-pills" role="tablist" aria-label="Filter conversations">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={connectionFilter === 'all'}
                          className={`chat-filter-pill ${connectionFilter === 'all' ? 'chat-filter-pill--active' : ''}`}
                          onClick={() => setConnectionFilter('all')}
                        >
                          ALL
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={connectionFilter === 'unread'}
                          className={`chat-filter-pill ${connectionFilter === 'unread' ? 'chat-filter-pill--active' : ''}`}
                          onClick={() => setConnectionFilter('unread')}
                        >
                          Unread {activeTab === 'Group' ? groupsUnreadCount : unreadConversationsCount}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={connectionFilter === 'favorites'}
                          className={`chat-filter-pill ${connectionFilter === 'favorites' ? 'chat-filter-pill--active' : ''}`}
                          onClick={() => setConnectionFilter('favorites')}
                        >
                          Favorites {activeTab === 'Group' ? groupsFavoritesCount : favoritesCount}
                        </button>
                      </div>
                      <div className="chat-left-header-actions">
                        {activeTab === 'Whispers' && (
                          <button
                            type="button"
                            className={`chat-header-action-btn chat-header-action-btn--icon ${(selectedConversationIds.size > 0 || (selectedId && selectedId !== SELF_PLACEHOLDER_ID && !displayList.find((c) => c.id === selectedId)?.isBlocked && !String(selectedId).startsWith(CONNECTION_PLACEHOLDER_PREFIX))) ? 'chat-header-action-btn--highlight' : ''}`}
                            onClick={() => {
                              const toClear =
                                selectedConversationIds.size > 0
                                  ? Array.from(selectedConversationIds)
                                  : selectedId && selectedId !== SELF_PLACEHOLDER_ID && !String(selectedId).startsWith(CONNECTION_PLACEHOLDER_PREFIX) && displayList.some((c) => c.id === selectedId && !c.isBlocked)
                                    ? [selectedId]
                                    : [];
                              if (toClear.length === 0) return;
                              if (!window.confirm(`Clear all messages for ${toClear.length} conversation(s)? This cannot be undone.`)) return;
                              chat.clearConversations(toClear).then(({ cleared }) => {
                                if (cleared.length) {
                                  if (selectedId && cleared.includes(selectedId)) setMessages([]);
                                  chat.getConversations().then((list) => {
                                    setConversations((prev) => {
                                      const self = prev.find((c) => c.name === 'You');
                                      const rest = (list || []).filter((c) => c.name !== 'You');
                                      return self ? [self, ...rest] : rest;
                                    });
                                  }).catch(() => { });
                                }
                                setConnectionSelectionMode(false);
                                setSelectedConversationIds(new Set());
                              }).catch(() => { });
                            }}
                            aria-label="Clear chat"
                            title="Clear chat"
                          >
                            <ClearChatIcon />
                          </button>
                        )}
                        {activeTab === 'Whispers' && (
                          <button
                            type="button"
                            className="chat-header-action-btn chat-header-action-btn--icon"
                            onClick={() => refetchConversationsList()}
                            disabled={conversationsLoading}
                            aria-label="Refresh list"
                            title="Refresh list"
                          >
                            {conversationsLoading ? (
                              <span className="chat-refresh-spinner" aria-hidden />
                            ) : (
                              <RefreshListIcon />
                            )}
                          </button>
                        )}
                        {activeTab === 'Group' && (
                          <button
                            type="button"
                            className="chat-header-action-btn chat-header-action-btn--icon"
                            onClick={() => refetchGroupsList()}
                            disabled={groupsLoading}
                            aria-label="Refresh list"
                            title="Refresh list"
                          >
                            {groupsLoading ? (
                              <span className="chat-refresh-spinner" aria-hidden />
                            ) : (
                              <RefreshListIcon />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className={`chat-left-list${activeTab === 'Group' ? ' chat-left-list--group' : ''}`} role="list">
                {activeTab === 'Archive' ? (
                  archiveCallLogsLoading ? (
                    <div className="chat-section-loader" aria-live="polite">
                      <span className="chat-section-loader-spinner" aria-hidden />
                      <span>Loading call history...</span>
                    </div>
                  ) : callLogs.length === 0 ? (
                    <p className="chat-left-list-empty">No call history yet</p>
                  ) : (
                    <>
                      {callLogSelectionMode && callLogs.length > 0 && (
                        <div
                          className="chat-select-all-row"
                          role="button"
                          tabIndex={0}
                          data-keep-call-log-selection-open
                          onClick={() => {
                            const allIds = new Set(callLogs.map((c) => c.id));
                            const allSelected = callLogs.every((c) => selectedCallLogIds.has(c.id));
                            setSelectedCallLogIds(allSelected ? new Set() : allIds);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const allIds = new Set(callLogs.map((c) => c.id));
                              const allSelected = callLogs.every((c) => selectedCallLogIds.has(c.id));
                              setSelectedCallLogIds(allSelected ? new Set() : allIds);
                            }
                          }}
                          aria-label="Select all call logs"
                        >
                          <input
                            type="checkbox"
                            className="chat-conv-row-checkbox"
                            checked={callLogs.length > 0 && callLogs.every((c) => selectedCallLogIds.has(c.id))}
                            readOnly
                            tabIndex={-1}
                            aria-hidden
                          />
                          <span className="chat-select-all-label">Select All</span>
                        </div>
                      )}
                      {callLogs.map((log) => (
                        <CallLogRow
                          key={log.id}
                          log={log}
                          onClick={() => {
                            if (callLogSelectionMode) {
                              setSelectedCallLogIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(log.id)) next.delete(log.id);
                                else next.add(log.id);
                                return next;
                              });
                            } else {
                              setCallLogSelectionMode(true);
                              setSelectedCallLogIds(new Set([log.id]));
                            }
                          }}
                          onDoubleClick={() => {
                            if (!callLogSelectionMode) {
                              setCallLogSelectionMode(true);
                              setSelectedCallLogIds(new Set([log.id]));
                            }
                          }}
                          selectionMode={callLogSelectionMode}
                          selected={selectedCallLogIds.has(log.id)}
                          onToggleSelect={(e) => {
                            e.stopPropagation();
                            setSelectedCallLogIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(log.id)) next.delete(log.id);
                              else next.add(log.id);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </>
                  )
                ) : activeTab === 'Group' ? (
                  groupsLoading ? (
                    <div className="chat-section-loader" aria-live="polite">
                      <span className="chat-section-loader-spinner" aria-hidden />
                      <span>Loading groups...</span>
                    </div>
                  ) : pendingGroupInvites.length === 0 && groupDisplayList.length === 0 ? (
                    <p className="chat-left-list-empty">No groups yet</p>
                  ) : (
                    <>
                      {pendingGroupInvites.length > 0 && (
                        <div className="chat-group-pending-invites">
                          <p className="chat-group-pending-invites-title">Group invites</p>
                          {pendingGroupInvites.map((inv) => (
                            <GroupInviteRow
                              key={inv.id}
                              invite={inv}
                              onAccept={async () => {
                                const ok = await groupsApi.acceptInvite(inv.id);
                                if (ok) {
                                  const [list, invites] = await Promise.all([groupsApi.getGroups(), groupsApi.getPendingInvites()]);
                                  setGroups(list);
                                  setPendingGroupInvites(Array.isArray(invites) ? invites : []);
                                  const joined = list.find((g) => g.name === (inv.group_name || ''));
                                  if (joined) {
                                    setSelectedGroupId(joined.id);
                                    setSelectedId(joined.conversation_id);
                                  }
                                }
                              }}
                              onReject={async () => {
                                await groupsApi.rejectInvite(inv.id);
                                const invites = await groupsApi.getPendingInvites();
                                setPendingGroupInvites(Array.isArray(invites) ? invites : []);
                              }}
                            />
                          ))}
                        </div>
                      )}
                      {groupDisplayList.map((group) => (
                        <GroupRow
                          key={group.id}
                          group={group}
                          isActive={selectedId === group.conversation_id}
                          onClick={() => {
                            setSelectedId(group.conversation_id);
                            setSelectedGroupId(group.id);
                            unreadCountedIdsRef.current.delete(group.conversation_id);
                            chat.markRead(group.conversation_id).then(() => {
                              if (currentUser?.id) emitConversationRead(group.conversation_id, currentUser.id);
                            }).catch(() => { });
                            setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, unreadCount: 0 } : g)));
                          }}
                          onStarClick={(e) => {
                            e.stopPropagation();
                            setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, isFavorite: !g.isFavorite } : g)));
                            chat.setFavorite(group.conversation_id, !group.isFavorite).catch(() => { });
                          }}
                        />
                      ))}
                    </>
                  )
                ) : conversationsLoading ? (
                  <div className="chat-section-loader" aria-live="polite">
                    <span className="chat-section-loader-spinner" aria-hidden />
                    <span>Loading connections...</span>
                  </div>
                ) : (
                  <>
                    {connectionSelectionMode && displayList.length > 0 && (
                      <div
                        className="chat-select-all-row"
                        role="button"
                        tabIndex={0}
                        data-keep-connection-selection-open
                        onClick={() => {
                          const allIds = new Set(displayList.map((c) => c.id));
                          const current = selectedConversationIds;
                          const allSelected = displayList.every((c) => current.has(c.id));
                          setSelectedConversationIds(allSelected ? new Set() : allIds);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            const allIds = new Set(displayList.map((c) => c.id));
                            const allSelected = displayList.every((c) => selectedConversationIds.has(c.id));
                            setSelectedConversationIds(allSelected ? new Set() : allIds);
                          }
                        }}
                        aria-label="Select all"
                      >
                        <input
                          type="checkbox"
                          className="chat-conv-row-checkbox"
                          checked={displayList.length > 0 && displayList.every((c) => selectedConversationIds.has(c.id))}
                          readOnly
                          tabIndex={-1}
                          aria-hidden
                        />
                        <span className="chat-select-all-label">Select All</span>
                      </div>
                    )}
                    {displayList.length === 0 ? (
                      <p className="chat-left-list-empty">No connections yet</p>
                    ) : (
                      displayList.map((item) => (
                        <ConversationRow
                          key={item.id}
                          item={{
                            ...item,
                            isOnline: item.otherUserId ? (onlineUserIds.has(item.otherUserId) || item.isOnline) : item.isOnline,
                          }}
                          currentUserId={currentUser?.id}
                          isActive={selectedId === item.id}
                          onClick={() => {
                            if (connectionSelectionMode) {
                              setSelectedConversationIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              });
                            } else {
                              handleRowClick(item);
                            }
                          }}
                          onStarClick={(e) => handleStarClick(e, item.id)}
                          onAvatarClick={(src, label) => setLightbox({ src, label })}
                          selectionMode={connectionSelectionMode}
                          selected={selectedConversationIds.has(item.id)}
                          onToggleSelect={(e) => {
                            e.stopPropagation();
                            setSelectedConversationIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            });
                          }}
                          onDoubleClick={() => {
                            setConnectionSelectionMode(true);
                            setSelectedConversationIds((prev) => new Set(prev).add(item.id));
                          }}
                        />
                      ))
                    )}
                  </>
                )}
              </div>
              {activeTab === 'Group' && showCreateGroupForm && (
                <div className="chat-group-create-form-overlay">
                  <div className="chat-group-create-form-card">
                    <h3 className="chat-group-create-form-title">New group</h3>
                    <input
                      type="text"
                      className="chat-group-create-form-input"
                      placeholder="Group name"
                      value={createGroupName}
                      onChange={(e) => setCreateGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateGroup();
                      }}
                      aria-label="Group name"
                      disabled={createGroupSubmitting}
                      autoFocus
                    />
                    <div className="chat-group-create-form-actions">
                      <button
                        type="button"
                        className="chat-group-create-form-cancel"
                        onClick={() => {
                          if (!createGroupSubmitting) {
                            setShowCreateGroupForm(false);
                            setCreateGroupName('');
                          }
                        }}
                        disabled={createGroupSubmitting}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="chat-group-create-form-submit"
                        onClick={handleCreateGroup}
                        disabled={!createGroupName.trim() || createGroupSubmitting}
                      >
                        {createGroupSubmitting ? 'Creating...' : 'Create new group'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {activeTab === 'Group' && (
              <div className="chat-left-footer">
                <button
                  type="button"
                  className="chat-group-create-btn-fixed"
                  onClick={() => setShowCreateGroupForm(true)}
                  aria-label="Create group"
                  title="Create group"
                >
                  <span className="chat-group-create-btn-fixed-icon" aria-hidden>+</span>
                  <span>Create group</span>
                </button>
              </div>
            )}
          </div>
          <div className="chat-section-col chat-section-col--right">
            <div className={`chat-right-inner${activeTab === 'Group' ? ' chat-right-inner--group' : ''}`}>
              <div className="chat-right-chat-wrap">
                {((activeTab === 'Whispers' && selectedId && selectedConv) || (activeTab === 'Group' && selectedId && groups.some((g) => g.conversation_id === selectedId))) && (() => {
                  const displayName = activeTab === 'Group'
                    ? (groups.find((g) => g.conversation_id === selectedId)?.name ?? 'Group')
                    : (selectedConv?.name ?? 'Chat');
                  const avatarUrl = activeTab === 'Group'
                    ? groups.find((g) => g.conversation_id === selectedId)?.avatar_url ?? null
                    : selectedConv?.avatar_url ?? null;
                  const initials = displayName.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '') || '?';
                  const headerOnline = activeTab === 'Whispers' && selectedConv
                    ? (selectedConv.otherUserId ? (onlineUserIds.has(selectedConv.otherUserId) || selectedConv.isOnline) : selectedConv.isOnline)
                    : false;
                  return (
                    <div className="chat-mobile-back-bar" aria-hidden>
                      <button
                        type="button"
                        className="chat-mobile-back-btn"
                        onClick={() => {
                          setSelectedId(null);
                          if (activeTab === 'Group') {
                            setSelectedGroupId(null);
                            setGroupSettingsOpen(false);
                          }
                        }}
                        aria-label="Back to list"
                      >
                        <span className="chat-mobile-back-btn-icon">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                          </svg>
                        </span>
                        <span className="chat-mobile-back-label">Back</span>
                      </button>
                      <div className="chat-mobile-back-avatar-title">
                        <div className="chat-mobile-back-avatar-wrap">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="chat-mobile-back-avatar" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="chat-mobile-back-avatar-initials">{initials}</span>
                          )}
                        </div>
                        <span className="chat-mobile-back-title">{displayName}</span>
                      </div>
                      {activeTab === 'Group' && selectedId && selectedGroupId && (
                        <button
                          type="button"
                          className="chat-mobile-group-settings-btn"
                          onClick={() => setGroupSettingsOpen(true)}
                          aria-label="Group settings"
                          title="Group settings"
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          </svg>
                        </button>
                      )}
                      {activeTab !== 'Group' && !isSelectedBlocked && (
                        <>
                          {activeTab === 'Whispers' && selectedConv && (
                            <div
                              className={`chat-mobile-status-pill ${headerOnline ? 'chat-mobile-status-pill--online' : 'chat-mobile-status-pill--offline'}`}
                              aria-live="polite"
                              aria-label={headerOnline ? 'Online' : 'Offline'}
                            >
                              <span className="chat-mobile-status-pill-dot" aria-hidden />
                              <span className="chat-mobile-status-pill-text">{headerOnline ? 'Online' : 'Offline'}</span>
                            </div>
                          )}
                          <div className="chat-mobile-call-actions">
                            <button
                              type="button"
                              className="chat-mobile-call-btn"
                              onClick={() => startCall(selectedId!, 'video')}
                              disabled={callState !== 'idle'}
                              aria-label="Video call"
                              title="Video call"
                            >
                              <VideoCallIcon />
                            </button>
                            <button
                              type="button"
                              className="chat-mobile-call-btn"
                              onClick={() => startCall(selectedId!, 'audio')}
                              disabled={callState !== 'idle'}
                              aria-label="Voice call"
                              title="Voice call"
                            >
                              <AudioCallIcon />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                <div className="chat-right-chat-scroll">
                  <div ref={messagesScrollContainerRef} className="chat-messages-inner">
                    {((activeTab === 'Group' && (!selectedGroupId || !selectedId)) || (activeTab !== 'Group' && !selectedId)) ? (
                      <div className="chat-right-chat-placeholder chat-right-chat-placeholder--centered">
                        {activeTab === 'Group' && createGroupSubmitting ? (
                          <>
                            <span className="chat-section-loader-spinner" aria-hidden />
                            <span>Creating group...</span>
                          </>
                        ) : activeTab === 'Group' ? (
                          groupDisplayList.length === 0
                            ? 'No groups yet. Create one to get started.'
                            : 'Select a group'
                        ) : (
                          'Select a conversation from the list to start chatting'
                        )}
                      </div>
                    ) : isSelectedBlocked ? (
                      <div className="chat-block-banner">
                        <p className="chat-block-banner-text">
                          You have blocked {selectedConv?.name ? `@${selectedConv.name}` : 'this user'}.
                        </p>
                        {showUnblockConfirm === selectedId ? (
                          <div className="chat-unblock-confirm">
                            <p>Do you want to Unblock {selectedConv?.name ? `@${selectedConv.name}` : 'this user'}?</p>
                            <div className="chat-unblock-actions">
                              <button
                                type="button"
                                className="chat-unblock-btn chat-unblock-btn--secondary"
                                onClick={() => setShowUnblockConfirm(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="chat-unblock-btn chat-unblock-btn--primary"
                                onClick={() => {
                                  const otherId = selectedConv?.otherUserId;
                                  const convId = selectedId;
                                  if (!otherId) return;
                                  chat.unblockUser(otherId).then(() => {
                                    setConversations((prev) =>
                                      prev.map((c) =>
                                        c.id === convId ? { ...c, isBlocked: false } : c
                                      )
                                    );
                                    setShowUnblockConfirm(null);
                                    setMessagesLoadError(null);
                                    if (convId) {
                                      chat.getMessages(convId).then((list) => setMessages(list as ChatMessage[])).catch((err: Error) => {
                                        setMessagesLoadError(err?.message ?? 'Couldn\'t load messages');
                                        setMessages([]);
                                      });
                                    }
                                  }).catch(() => { });
                                }}
                              >
                                Unblock
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="chat-block-banner-unblock-btn"
                            onClick={() => setShowUnblockConfirm(selectedId)}
                          >
                            Unblock
                          </button>
                        )}
                      </div>
                    ) : activeTab === 'Group' && createGroupSubmitting ? (
                      <div className="chat-section-loader chat-section-loader--messages" aria-live="polite">
                        <span className="chat-section-loader-spinner" aria-hidden />
                        <span>Creating group...</span>
                      </div>
                    ) : messagesLoading ? (
                      <div className="chat-section-loader chat-section-loader--messages" aria-live="polite">
                        <span className="chat-section-loader-spinner" aria-hidden />
                        <span>Loading messages...</span>
                      </div>
                    ) : messagesLoadError ? (
                      <div className="chat-right-chat-placeholder chat-right-chat-placeholder--centered chat-messages-load-error">
                        <p className="chat-messages-load-error-text">{messagesLoadError}</p>
                        <button
                          type="button"
                          className="chat-messages-retry-btn"
                          onClick={() => loadMessagesForSelected()}
                        >
                          Retry
                        </button>
                      </div>
                    ) : messages.length === 0 && !otherUserTyping ? (
                      <div className="chat-right-chat-placeholder chat-right-chat-placeholder--centered">
                        No messages yet. Say hi!
                      </div>
                    ) : (
                      <>
                        <div ref={messagesListWrapRef} className="chat-messages-list-wrap" {...(messageSelectionMode ? { 'data-keep-selection-open': true } : {})}>
                          {messageSelectionMode && messages.length > 0 && (
                            <div
                              className="chat-message-select-all"
                              role="button"
                              tabIndex={0}
                              data-keep-selection-open
                              onClick={() => {
                                const allIds = new Set(messages.map((m) => m.id));
                                const allSelected = messages.every((m) => selectedMessageIds.has(m.id));
                                setSelectedMessageIds(allSelected ? new Set() : allIds);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  const allIds = new Set(messages.map((m) => m.id));
                                  const allSelected = messages.every((m) => selectedMessageIds.has(m.id));
                                  setSelectedMessageIds(allSelected ? new Set() : allIds);
                                }
                              }}
                              aria-label="Select all messages"
                            >
                              <input
                                type="checkbox"
                                className="chat-message-checkbox"
                                checked={messages.length > 0 && messages.every((m) => selectedMessageIds.has(m.id))}
                                readOnly
                                tabIndex={-1}
                                aria-hidden
                              />
                              <span className="chat-select-all-label">Select All</span>
                            </div>
                          )}
                          {(() => {
                            type TimelineItem =
                              | { type: 'message'; timestamp: string; item: ChatMessage }
                              | { type: 'call'; timestamp: string; item: CallLogListItem };
                            const timeline: TimelineItem[] = [
                              ...messages.map((m) => ({ type: 'message' as const, timestamp: m.created_at, item: m })),
                              ...callLogsInConversation.map((l) => ({ type: 'call' as const, timestamp: l.started_at, item: l })),
                            ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                            const groups: { dateLabel: string; items: TimelineItem[] }[] = [];
                            let currentDate = '';
                            for (const entry of timeline) {
                              const dateLabel = formatMessageDate(entry.timestamp);
                              if (dateLabel !== currentDate) {
                                currentDate = dateLabel;
                                groups.push({ dateLabel, items: [entry] });
                              } else {
                                groups[groups.length - 1].items.push(entry);
                              }
                            }
                            const myId = currentUser?.id ?? '';
                            const firstSelectedId = messages.find((m) => selectedMessageIds.has(m.id))?.id ?? null;
                            const renderMessageActionsDropdown = () => (
                              <div className="chat-message-actions-dropdown" role="menu" aria-label="Message actions" data-keep-selection-open>
                                <button
                                  type="button"
                                  className="chat-message-action-dropdown-item"
                                  role="menuitem"
                                  onClick={async () => {
                                    if (!selectedId || !currentUser?.id) return;
                                    setMessageActionLoading(true);
                                    try {
                                      const ids = Array.from(selectedMessageIds);
                                      const realIds = ids.filter((id) => !id.startsWith('temp-'));
                                      if (realIds.length > 0) {
                                        try {
                                          await chat.deleteMessagesForMe(selectedId, realIds);
                                        } catch {
                                          // ignore; still remove from UI below
                                        }
                                      }
                                      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
                                      setMessageSelectionMode(false);
                                      setSelectedMessageIds(new Set());
                                    } finally {
                                      setMessageActionLoading(false);
                                    }
                                  }}
                                >
                                  Delete for me
                                </button>
                                <button
                                  type="button"
                                  className="chat-message-action-dropdown-item"
                                  role="menuitem"
                                  onClick={async () => {
                                    if (!selectedId || !currentUser?.id) return;
                                    const mine = Array.from(selectedMessageIds).filter((id) => {
                                      const m = messages.find((x) => x.id === id);
                                      return m?.sender_id === currentUser.id;
                                    });
                                    if (mine.length === 0) return;
                                    setMessageActionLoading(true);
                                    try {
                                      await chat.deleteMessagesForEveryone(selectedId, mine);
                                      const list = await chat.getMessages(selectedId);
                                      setMessages(list as ChatMessage[]);
                                      setMessageSelectionMode(false);
                                      setSelectedMessageIds(new Set());
                                    } catch {
                                      // ignore
                                    } finally {
                                      setMessageActionLoading(false);
                                    }
                                  }}
                                >
                                  Delete for everyone
                                </button>
                                <button
                                  type="button"
                                  className="chat-message-action-dropdown-item"
                                  role="menuitem"
                                  onClick={async () => {
                                    if (!selectedId || !currentUser?.id) return;
                                    const ids = Array.from(selectedMessageIds);
                                    const mine = ids.filter((id) => {
                                      const m = messages.find((x) => x.id === id);
                                      return m?.sender_id === currentUser.id;
                                    });
                                    const now = Date.now();
                                    const within2hr = mine.filter((id) => {
                                      const m = messages.find((x) => x.id === id);
                                      if (!m) return false;
                                      return now - new Date(m.created_at).getTime() <= UNSEND_2HR_MS;
                                    });
                                    const tooOld = mine.length > within2hr.length;
                                    if (tooOld || mine.length === 0) {
                                      if (typeof localStorage !== 'undefined' && !localStorage.getItem(UNSEND_PROMPT_KEY)) {
                                        localStorage.setItem(UNSEND_PROMPT_KEY, '1');
                                        window.alert('Only messages within 2 hours can be unsent.');
                                      }
                                      if (within2hr.length === 0) return;
                                    }
                                    setMessageActionLoading(true);
                                    try {
                                      await chat.unsendMessages(selectedId, within2hr);
                                      const list = await chat.getMessages(selectedId);
                                      setMessages(list as ChatMessage[]);
                                      setMessageSelectionMode(false);
                                      setSelectedMessageIds(new Set());
                                    } catch {
                                      // ignore
                                    } finally {
                                      setMessageActionLoading(false);
                                    }
                                  }}
                                >
                                  Unsend
                                </button>
                                <button
                                  type="button"
                                  className="chat-message-action-dropdown-item"
                                  role="menuitem"
                                  onClick={() => {
                                    const ids = Array.from(selectedMessageIds);
                                    const firstId = ids[0];
                                    const msg = firstId ? messages.find((m) => m.id === firstId) : null;
                                    if (msg) {
                                      setReplyingTo(msg);
                                      setMessageSelectionMode(false);
                                      setSelectedMessageIds(new Set());
                                    }
                                  }}
                                >
                                  Reply
                                </button>
                              </div>
                            );
                            return groups.flatMap((g) => [
                              <MessageDateSeparator key={`sep-${g.dateLabel}`} dateLabel={g.dateLabel} />,
                              ...g.items.map((entry) => {
                                if (entry.type === 'call') {
                                  return <ChatCallLogEntry key={`call-${entry.item.id}`} log={entry.item} />;
                                }
                                const msg = entry.item;
                                const isSender = msg.sender_id === myId;
                                const isFirstSelected = msg.id === firstSelectedId;
                                const bubble = (
                                  <MessageBubble
                                    key={msg.id}
                                    message={msg}
                                    isSender={isSender}
                                    onImageClick={messageSelectionMode ? undefined : (src, label) => setLightbox({ src, label })}
                                    selectionMode={messageSelectionMode}
                                    selected={selectedMessageIds.has(msg.id)}
                                    onToggleSelect={() => {
                                      setSelectedMessageIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(msg.id)) next.delete(msg.id);
                                        else next.add(msg.id);
                                        return next;
                                      });
                                    }}
                                    onReplyQuoteClick={scrollToMessageId}
                                    highlighted={highlightedMessageId === msg.id}
                                    onDoubleClick={() => {
                                      if (!messageSelectionMode) {
                                        setMessageSelectionMode(true);
                                        setSelectedMessageIds(new Set([msg.id]));
                                      }
                                    }}
                                    onLongPress={
                                      !messageSelectionMode
                                        ? () => {
                                          setMessageSelectionMode(true);
                                          setSelectedMessageIds(new Set([msg.id]));
                                        }
                                        : undefined
                                    }
                                  />
                                );
                                if (messageSelectionMode && selectedMessageIds.size > 0 && isFirstSelected) {
                                  return [
                                    <div
                                      key={`wrap-${msg.id}`}
                                      className={`chat-message-actions-inline-wrap ${isSender ? 'chat-message-actions-inline-wrap--sender' : 'chat-message-actions-inline-wrap--receiver'}`}
                                    >
                                      {isSender ? (
                                        <>
                                          {renderMessageActionsDropdown()}
                                          {bubble}
                                        </>
                                      ) : (
                                        <>
                                          {bubble}
                                          {renderMessageActionsDropdown()}
                                        </>
                                      )}
                                    </div>,
                                    messageActionLoading ? (
                                      <div key={`message-action-loader-${msg.id}`} className="chat-message-action-loader" aria-live="polite">
                                        <span className="chat-message-action-loader-spinner" aria-hidden />
                                        <span>Updating…</span>
                                      </div>
                                    ) : null,
                                  ].filter(Boolean);
                                }
                                return bubble;
                              }),
                            ]);
                          })()}
                        </div>
                        {callLogsRefreshing && (
                          <div className="chat-call-log-refresh-loader" aria-live="polite">
                            <span className="chat-call-log-refresh-loader-spinner" aria-hidden />
                            <span>Updating call log...</span>
                          </div>
                        )}
                        {otherUserTyping && (
                          <div className="chat-typing-indicator" aria-live="polite" role="status">
                            <span className="chat-typing-dots">
                              <span className="chat-typing-dot" aria-hidden />
                              <span className="chat-typing-dot" aria-hidden />
                              <span className="chat-typing-dot" aria-hidden />
                              <span className="chat-typing-dot" aria-hidden />
                            </span>
                            <span className="chat-typing-label">typing…</span>
                          </div>
                        )}
                      </>
                    )}
                    <div ref={messagesEndRef} aria-hidden />
                  </div>
                </div>
                {replyingTo && (
                  <div className="chat-reply-preview" role="status" aria-label={`Replying to ${replyingTo.sender_username || 'message'}`}>
                    <div className="chat-reply-preview-inner">
                      <span className="chat-reply-preview-label">
                        Replying to {replyingTo.sender_username ? `@${replyingTo.sender_username}` : 'message'}
                      </span>
                      <span className="chat-reply-preview-content">
                        {replyingTo.content_type === 'text'
                          ? (replyingTo.content.slice(0, 60) + (replyingTo.content.length > 60 ? '…' : ''))
                          : replyingTo.content_type === 'image'
                            ? 'Photo'
                            : 'Audio'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="chat-reply-preview-cancel"
                      onClick={() => setReplyingTo(null)}
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className={`chat-bar-wrap ${!canSend ? 'chat-bar-wrap--disabled' : ''}`}>
                  <div className="chat-bar">
                    <div className="chat-bar-actions">
                      <button
                        type="button"
                        className="chat-bar-btn"
                        onClick={() => canSend && fileInputRef.current?.click()}
                        disabled={!canSend}
                        aria-label="Attach image"
                      >
                        <AttachIcon />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        aria-hidden
                        onChange={handleAttachImage}
                      />
                      <button
                        type="button"
                        className={`chat-bar-btn ${isRecording ? 'chat-bar-btn--recording' : ''}`}
                        aria-label={isRecording ? 'Stop recording' : 'Record audio'}
                        disabled={!canSend}
                        onClick={handleToggleRecordAudio}
                      >
                        <MicIcon />
                      </button>
                    </div>
                    <div className="chat-bar-input-wrap">
                      <textarea
                        className="chat-bar-input"
                        placeholder={!canSend ? 'Select a conversation to message' : 'Type a message...'}
                        value={inputValue}
                        onChange={(e) => {
                          setInputValue(e.target.value);
                          notifyTypingStart();
                        }}
                        onBlur={notifyTypingStop}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendText();
                          }
                        }}
                        rows={1}
                        disabled={!canSend}
                        aria-label="Message input"
                      />
                    </div>
                    <button
                      type="button"
                      className="chat-bar-send"
                      disabled={!inputValue.trim() || !canSend}
                      onClick={handleSendText}
                      aria-label="Send message"
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
              </div>
              <div className="chat-right-calls-wrap">
                <div
                  className={`chat-right-video-section${isVideoCallActive ? ' chat-video-expanded' : ''}${isVideoCallActive && isResizingVideoPanel ? ' chat-video-expanded--resizing' : ''}`}
                  id="chat-video-section"
                  style={isVideoCallActive && !isMobileOrTablet ? { width: `${videoPanelWidthVw}vw` } : undefined}
                >
                  {isVideoCallActive && (
                    <div
                      className="chat-video-resize-handle"
                      role="separator"
                      aria-label="Resize video panel"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizingVideoPanel(true);
                      }}
                    />
                  )}
                  {callState !== 'idle' && callType === 'video' ? (
                    <>
                      {callState === 'ringing_outgoing' && (
                        <div className="chat-call-ui chat-call-ui--ringing">
                          <div className="chat-call-ringing-anim" aria-hidden />
                          <p className="chat-call-ui-text">Calling {selectedConv?.name ?? '...'}...</p>
                          <button type="button" className="chat-call-btn chat-call-btn--danger" onClick={endCall} aria-label="Cancel call">
                            <EndCallIcon /> Cancel
                          </button>
                        </div>
                      )}
                      {callState === 'ringing_incoming' && incomingCall && (
                        <div className="chat-call-ui chat-call-ui--incoming">
                          <p className="chat-call-ui-text">Incoming video call</p>
                          <div className="chat-call-ui-actions">
                            <button type="button" className="chat-call-btn chat-call-btn--danger" onClick={rejectCall} aria-label="Decline">
                              <EndCallIcon /> Decline
                            </button>
                            <button type="button" className="chat-call-btn chat-call-btn--primary" onClick={acceptCall} aria-label="Accept">
                              <VideoCallIcon /> Accept
                            </button>
                          </div>
                        </div>
                      )}
                      {callState === 'active' && (
                        <ActiveVideoCallView
                          showScreenShare={showScreenShareLayout}
                          screenStream={screenStream}
                          remoteScreenStream={remoteScreenStream}
                          localStream={localStream}
                          remoteStream={remoteStream}
                          isMuted={isMuted}
                          isVideoOff={isVideoOff}
                          isScreenSharing={isScreenSharing}
                          onToggleMute={toggleMute}
                          onToggleVideo={toggleVideo}
                          onToggleScreenShare={toggleScreenShare}
                          onEndCall={endCall}
                        />
                      )}
                    </>
                  ) : (
                    <div className="chat-call-ui chat-call-ui--idle">
                      <span className="chat-call-label">Video call</span>
                      {selectedId && selectedConv && !selectedConv.isBlocked ? (
                        <>
                          <p className="chat-call-ui-text">Call {selectedConv.name}</p>
                          <button type="button" className="chat-call-btn chat-call-btn--primary" onClick={() => startCall(selectedId, 'video')} disabled={callState !== 'idle'} aria-label="Start video call">
                            <VideoCallIcon /> Start video call
                          </button>
                        </>
                      ) : (
                        <p className="chat-call-ui-text chat-call-ui-text--muted">Select a conversation to start a video call</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="chat-right-audio-section" id="chat-audio-section">
                  {callState !== 'idle' && callType === 'audio' ? (
                    <>
                      {callState === 'ringing_outgoing' && (
                        <div className="chat-call-ui chat-call-ui--ringing chat-call-ui--compact">
                          <p className="chat-call-ui-text">Calling {selectedConv?.name ?? '...'}...</p>
                          <button type="button" className="chat-call-btn chat-call-btn--danger chat-call-btn--sm" onClick={endCall} aria-label="Cancel">
                            <EndCallIcon /> Cancel
                          </button>
                        </div>
                      )}
                      {callState === 'ringing_incoming' && incomingCall && (
                        <div className="chat-call-ui chat-call-ui--incoming chat-call-ui--compact">
                          <p className="chat-call-ui-text">Incoming audio call</p>
                          <div className="chat-call-ui-actions">
                            <button type="button" className="chat-call-btn chat-call-btn--danger chat-call-btn--sm" onClick={rejectCall} aria-label="Decline">
                              Decline
                            </button>
                            <button type="button" className="chat-call-btn chat-call-btn--primary chat-call-btn--sm" onClick={acceptCall} aria-label="Accept">
                              <AudioCallIcon /> Accept
                            </button>
                          </div>
                        </div>
                      )}
                      {callState === 'active' && (
                        <div className="chat-call-ui chat-call-ui--active chat-call-ui--compact">
                          <p className="chat-call-ui-text">{callConversationId ? (conversations.find((c) => c.id === callConversationId)?.name ?? 'In call') : 'In call'}</p>
                          <div className="chat-call-controls chat-call-controls--compact">
                            <button type="button" className={`chat-call-ctrl-btn ${isMuted ? 'chat-call-ctrl-btn--on' : ''}`} onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
                              <MuteIcon />
                            </button>
                            <button type="button" className="chat-call-ctrl-btn chat-call-ctrl-btn--danger" onClick={endCall} aria-label="End call">
                              <EndCallIcon />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="chat-call-ui chat-call-ui--idle chat-call-ui--compact">
                      <span className="chat-call-label">Audio call</span>
                      {selectedId && selectedConv && !selectedConv.isBlocked ? (
                        <button type="button" className="chat-call-btn chat-call-btn--primary chat-call-btn--sm" onClick={() => startCall(selectedId, 'audio')} disabled={callState !== 'idle'} aria-label="Start audio call">
                          <AudioCallIcon /> Start audio call
                        </button>
                      ) : (
                        <p className="chat-call-ui-text chat-call-ui-text--muted">Select a conversation to start an audio call</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {activeTab === 'Group' && (
                <div className="chat-right-group-settings">
                  {groupSettingsOpen && (
                    <div className="chat-group-settings-mobile-close">
                      <button
                        type="button"
                        className="chat-group-settings-mobile-close-btn"
                        onClick={() => setGroupSettingsOpen(false)}
                        aria-label="Back to chat"
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        <span>Back</span>
                      </button>
                    </div>
                  )}
                  <GroupSettingsPanel
                    groupId={selectedGroupId}
                    currentUserId={currentUser?.id ?? ''}
                    onlineUserIds={onlineUserIds}
                    onGroupUpdated={() => {
                      groupsApi.getGroups().then(setGroups).catch(() => { });
                      if (selectedGroupId && currentUser?.id) {
                        groupsApi.getGroup(selectedGroupId).then((g) => {
                          if (g) {
                            setGroupViewOnly(g.view_only_mode);
                            const me = g.members.find((m) => m.user_id === currentUser.id);
                            setGroupAmAdmin(me?.role === 'creator' || me?.role === 'admin');
                          }
                        }).catch(() => { });
                      }
                    }}
                    onLeftOrDeleted={() => {
                      groupsApi.getGroups().then(setGroups).catch(() => { });
                      setSelectedGroupId(null);
                      setSelectedId(null);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </ChatPageRoot>
  );
}

export { ChatPageContent };
