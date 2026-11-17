'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { groupsApi, type GroupWithMembers, type GroupMember, type ConnectionUser, type GroupInvitePending } from '@/services/groups';

const MAX_MEMBERS = 50;

const iconClass = 'chat-group-settings-icon';

function TrashIcon() {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className={iconClass} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg className={iconClass} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="chat-group-settings-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function MotiveIcon() {
  return (
    <svg className={iconClass} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.8 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg className={iconClass} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z" />
      <path d="M5 16h14" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg className={iconClass} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg className={iconClass} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export type GroupSettingsPanelProps = {
  groupId: string | null;
  currentUserId: string;
  onGroupUpdated?: () => void;
  onLeftOrDeleted?: () => void;
  /** Optional set of online user ids for real-time presence (merged with member.is_online from API). */
  onlineUserIds?: Set<string>;
};

export function GroupSettingsPanel({ groupId, currentUserId, onGroupUpdated, onLeftOrDeleted, onlineUserIds }: GroupSettingsPanelProps) {
  const [group, setGroup] = useState<GroupWithMembers | null>(null);
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<ConnectionUser[]>([]);
  const [invites, setInvites] = useState<GroupInvitePending[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [motiveDraft, setMotiveDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [membersOpen, setMembersOpen] = useState(true);
  const [addUsersOpen, setAddUsersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const loadGroup = useCallback(async () => {
    if (!groupId) {
      setGroup(null);
      return;
    }
    setLoading(true);
    try {
      const data = await groupsApi.getGroup(groupId);
      setGroup(data ?? null);
      if (data) {
        setNameDraft(data.name);
        setMotiveDraft(data.motive ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    if (!groupId) return;
    groupsApi.getGroupInvites(groupId).then(setInvites).catch(() => setInvites([]));
  }, [groupId]);

  useEffect(() => {
    groupsApi.getConnections().then(setConnections).catch(() => setConnections([]));
  }, []);

  const myRole = group?.members.find((m) => m.user_id === currentUserId)?.role;
  const isAdmin = myRole === 'creator' || myRole === 'admin';
  const isCreator = myRole === 'creator';
  const memberCount = group?.members.length ?? 0;
  const adminCount = group?.members.filter((m) => m.role === 'creator' || m.role === 'admin').length ?? 0;
  const canAddMoreAdmins = isCreator && adminCount < 3;
  const isFull = memberCount >= MAX_MEMBERS;

  const filteredConnections = searchQuery.trim()
    ? connections.filter((c) => {
        const un = (c.username ?? '').toLowerCase();
        const dn = (c.display_name ?? '').toLowerCase();
        const q = searchQuery.trim().toLowerCase();
        return un.includes(q) || dn.includes(q);
      })
    : [];
  const alreadyMembers = new Set(group?.members.map((m) => m.user_id) ?? []);
  const addableConnections = filteredConnections.filter((c) => !alreadyMembers.has(c.id));

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !groupId || !isCreator) return;
    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Image must be 2MB or smaller.');
      return;
    }
    e.target.value = '';
    setAvatarUploading(true);
    try {
      const result = await groupsApi.uploadGroupAvatar(groupId, file);
      if (result) {
        setGroup((g) => (g ? { ...g, avatar_url: result.avatar_url } : null));
        onGroupUpdated?.();
      } else {
        window.alert('Failed to upload avatar. Try again.');
      }
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveName = async () => {
    if (!groupId || !isAdmin || nameDraft.trim() === group?.name) return;
    setSaving(true);
    try {
      const ok = await groupsApi.updateGroup(groupId, { name: nameDraft.trim() });
      if (ok) {
        setGroup((g) => (g ? { ...g, name: nameDraft.trim() } : null));
        onGroupUpdated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMotive = async () => {
    if (!groupId || !isAdmin) return;
    setSaving(true);
    try {
      const ok = await groupsApi.updateGroup(groupId, { motive: motiveDraft.trim() || null });
      if (ok) {
        setGroup((g) => (g ? { ...g, motive: motiveDraft.trim() || null } : null));
        onGroupUpdated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleViewOnlyChange = async (checked: boolean) => {
    setPermError(null);
    if (!groupId || !isAdmin) return;
    setSaving(true);
    try {
      const ok = await groupsApi.updateGroup(groupId, { view_only_mode: checked });
      if (!ok) setPermError('Could not change view-only mode. Try again.');
      if (ok) {
        setGroup((g) => (g ? { ...g, view_only_mode: checked } : null));
        onGroupUpdated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePriorityChange = async (userId: string | null) => {
    setPermError(null);
    if (!groupId || !isAdmin) return;
    setSaving(true);
    try {
      const ok = await groupsApi.updateGroup(groupId, { priority_user_id: userId });
      if (!ok) setPermError('Could not change priority access. Try again.');
      if (ok) {
        setGroup((g) => (g ? { ...g, priority_user_id: userId } : null));
        onGroupUpdated?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSetRole = async (userId: string, role: 'admin' | 'member') => {
    if (!groupId || !isCreator) return;
    setSaving(true);
    try {
      const ok = await groupsApi.setMemberRole(groupId, userId, role);
      if (ok) await loadGroup();
      onGroupUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!groupId || !isAdmin) return;
    if (!window.confirm('Remove this member from the group?')) return;
    setSaving(true);
    try {
      const ok = await groupsApi.removeMember(groupId, userId);
      if (ok) {
        await loadGroup();
        onGroupUpdated?.();
        if (userId === currentUserId) onLeftOrDeleted?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!groupId) return;
    if (!window.confirm('Leave this group? You will no longer see its messages.')) return;
    setSaving(true);
    try {
      const ok = await groupsApi.removeMember(groupId, currentUserId);
      if (ok) {
        onGroupUpdated?.();
        onLeftOrDeleted?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupId || !isCreator) return;
    if (!window.confirm('This will remove the group and all messages. This cannot be undone.')) return;
    setSaving(true);
    try {
      const ok = await groupsApi.deleteGroup(groupId);
      if (ok) {
        onGroupUpdated?.();
        onLeftOrDeleted?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendInvite = async (invitedUserId: string) => {
    if (!groupId || !isAdmin || isFull) return;
    setInvitingId(invitedUserId);
    try {
      const result = await groupsApi.sendInvite(groupId, invitedUserId);
      if ('error' in result) {
        window.alert(result.error);
      } else {
        const list = await groupsApi.getGroupInvites(groupId);
        setInvites(list);
        onGroupUpdated?.();
      }
    } finally {
      setInvitingId(null);
    }
  };

  if (!groupId) {
    return (
      <div className="chat-right-group-settings-inner">
        <p className="chat-right-group-settings-placeholder">Select a group</p>
      </div>
    );
  }

  if (loading || !group) {
    return (
      <div className="chat-right-group-settings-inner">
        <div className="chat-group-settings-loader">
          <span className="chat-section-loader-spinner" aria-hidden />
          <span>Loading group…</span>
        </div>
      </div>
    );
  }

  const displayName = (m: GroupMember) => m.display_name || m.username || 'Unknown';
  /** Admins already post in view-only mode, so priority goes to an ordinary member. */
  const priorityCandidates = group.members.filter((m) => m.role !== 'creator' && m.role !== 'admin');

  return (
    <motion.div
      className="chat-right-group-settings-inner"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div className="chat-group-settings-header">
        <div className="chat-group-settings-avatar-wrap">
          {group.avatar_url ? (
            <img src={group.avatar_url} alt="" className="chat-group-settings-avatar" />
          ) : (
            <div className="chat-group-settings-avatar chat-group-settings-avatar--initials">
              {(group.name || 'G').slice(0, 1).toUpperCase()}
            </div>
          )}
          {isCreator && (
            <>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="chat-group-settings-avatar-input"
                aria-label="Upload group avatar"
                onChange={handleAvatarChange}
                disabled={avatarUploading}
              />
              <button
                type="button"
                className="chat-group-settings-avatar-change-btn"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                aria-label="Change group avatar"
                title="Change group avatar"
              >
                {avatarUploading ? (
                  <span className="chat-group-settings-avatar-change-spinner" aria-hidden />
                ) : (
                  <CameraIcon />
                )}
                <span className="chat-group-settings-avatar-change-label">{avatarUploading ? 'Uploading…' : 'Change'}</span>
              </button>
            </>
          )}
        </div>
        {isAdmin ? (
          <input
            type="text"
            className="chat-group-settings-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            disabled={saving}
            aria-label="Group name"
          />
        ) : (
          <h2 className="chat-group-settings-name">{group.name || 'Group'}</h2>
        )}
        <p className="chat-group-settings-member-count">{memberCount} member{memberCount !== 1 ? 's' : ''}</p>
      </div>

      <div className="chat-group-settings-section">
        <label className="chat-group-settings-label chat-group-settings-label--with-icon">
          <MotiveIcon />
          <span>Motive</span>
        </label>
        {isAdmin ? (
          <textarea
            className="chat-group-settings-motive"
            value={motiveDraft}
            onChange={(e) => setMotiveDraft(e.target.value)}
            onBlur={handleSaveMotive}
            placeholder="Short bio or purpose..."
            rows={2}
            disabled={saving}
          />
        ) : (
          <p className="chat-group-settings-motive-readonly">{group.motive || '—'}</p>
        )}
      </div>

      <div className="chat-group-settings-section chat-group-settings-members">
        <button
          type="button"
          className="chat-group-settings-collapse-btn"
          onClick={() => setMembersOpen(!membersOpen)}
          aria-expanded={membersOpen}
        >
          <span className="chat-group-settings-collapse-btn-left">
            <UsersIcon />
            <span>Members</span>
          </span>
          <ChevronIcon open={membersOpen} />
        </button>
        <AnimatePresence initial={false}>
          {membersOpen && (
            <motion.div
              className="chat-group-settings-members-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
            {group.members.map((m) => {
              const isOnline = m.user_id === currentUserId || onlineUserIds?.has(m.user_id) || m.is_online === true;
              return (
              <div key={m.user_id} className="chat-group-settings-member-row">
                <div className="chat-group-settings-member-avatar-wrap">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="chat-group-settings-member-avatar" />
                  ) : (
                    <div className="chat-group-settings-member-avatar chat-group-settings-member-avatar--initials">
                      {(displayName(m)).slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={`chat-conv-row-status ${isOnline ? 'chat-conv-row-status--online' : 'chat-conv-row-status--offline'}`}
                    aria-label={isOnline ? 'Online' : 'Offline'}
                  />
                </div>
                <span className="chat-group-settings-member-name">{displayName(m)}</span>
                {m.role !== 'member' && (
                  <span className="chat-group-settings-member-role">{m.role === 'creator' ? 'Creator' : 'Admin'}</span>
                )}
                {m.user_id === currentUserId ? (
                  <button
                    type="button"
                    className="chat-group-settings-member-action chat-group-settings-leave-btn"
                    onClick={handleLeaveGroup}
                    disabled={saving}
                    aria-label="Leave group"
                    title="Leave group"
                  >
                    <LogOutIcon />
                    <span>Leave group</span>
                  </button>
                ) : isAdmin && m.role !== 'creator' && (
                  <div className="chat-group-settings-member-actions">
                    {isCreator && m.role === 'member' && canAddMoreAdmins && (
                      <button
                        type="button"
                        className="chat-group-settings-member-action"
                        onClick={() => handleSetRole(m.user_id, 'admin')}
                        disabled={saving}
                        title="Make admin"
                      >
                        Admin
                      </button>
                    )}
                    {isCreator && m.role === 'admin' && (
                      <button
                        type="button"
                        className="chat-group-settings-member-action"
                        onClick={() => handleSetRole(m.user_id, 'member')}
                        disabled={saving}
                        title="Remove admin"
                      >
                        Member
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-group-settings-member-action chat-group-settings-member-action--danger"
                      onClick={() => handleRemoveMember(m.user_id)}
                      disabled={saving}
                      aria-label="Remove member"
                      title="Remove from group"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </div>
            ); })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isAdmin && (
        <>
          <div className="chat-group-settings-section chat-group-settings-add-users">
            <button
              type="button"
              className="chat-group-settings-add-btn"
              onClick={() => setAddUsersOpen(!addUsersOpen)}
              title={`Add users to group ${group.name}`}
              disabled={isFull}
            >
              <UserPlusIcon />
              <span>{addUsersOpen ? 'Hide' : 'Add users to group'}</span>
            </button>
            <AnimatePresence initial={false}>
              {addUsersOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  style={{ overflow: 'hidden' }}
                >
                {isFull ? (
                  <p className="chat-group-settings-full">Group is full (max {MAX_MEMBERS})</p>
                ) : (
                  <>
                    <div className="chat-group-settings-search-wrap">
                      <SearchIcon />
                      <input
                        type="text"
                        className="chat-group-settings-search"
                        placeholder="Search by username..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search connections"
                      />
                    </div>
                    <div className="chat-group-settings-connections-list">
                      {addableConnections.slice(0, 10).map((c) => {
                        const inv = invites.find((i) => i.invited_user_id === c.id);
                        const status = inv?.status ?? null;
                        return (
                          <div key={c.id} className="chat-group-settings-connection-row">
                            <div className="chat-group-settings-member-avatar-wrap">
                              {c.avatar_url ? (
                                <img src={c.avatar_url} alt="" className="chat-group-settings-member-avatar" />
                              ) : (
                                <div className="chat-group-settings-member-avatar chat-group-settings-member-avatar--initials">
                                  {(c.display_name || c.username || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <span className="chat-group-settings-member-name">{c.display_name || c.username || c.id}</span>
                            <button
                              type="button"
                              className="chat-group-settings-add-one-btn"
                              onClick={() => handleSendInvite(c.id)}
                              disabled={!!status || invitingId === c.id}
                              title={status === 'pending' ? 'Invite sent' : status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Add'}
                            >
                              {invitingId === c.id ? '…' : status === 'pending' ? 'Invite sent' : status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Add'}
                            </button>
                          </div>
                        );
                      })}
                      {searchQuery.trim() && addableConnections.length === 0 && (
                        <p className="chat-group-settings-no-results">No connections match</p>
                      )}
                    </div>
                  </>
                )}
                {invites.length > 0 && (
                  <div className="chat-group-settings-invites-status">
                    <span className="chat-group-settings-label">Invites</span>
                    {invites.slice(0, 5).map((inv) => (
                      <div key={inv.id} className="chat-group-settings-invite-row">
                        <span>{inv.invitee_username ?? inv.invited_user_id}</span>
                        <span className="chat-group-settings-invite-status">{inv.status}</span>
                      </div>
                    ))}
                  </div>
                )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="chat-group-settings-section chat-group-settings-permissions">
            <span className="chat-group-settings-label chat-group-settings-label--with-icon">
              <ShieldIcon />
              <span>Permissions</span>
            </span>
            <label className="chat-group-settings-toggle-wrap">
              <input
                type="checkbox"
                checked={group.view_only_mode}
                onChange={(e) => handleViewOnlyChange(e.target.checked)}
                disabled={saving}
              />
              <span>View-only mode (only admins can send messages)</span>
            </label>
            {permError ? (
              <p className="chat-group-settings-error" role="alert">
                {permError}
              </p>
            ) : null}
            {priorityCandidates.length > 0 && (
              <div className="chat-group-settings-priority">
                <label className="chat-group-settings-label chat-group-settings-label--with-icon">
                  <CrownIcon />
                  <span>Priority access (optional): this member can also post in view-only mode</span>
                </label>
                <select
                  className="chat-group-settings-select"
                  value={group.priority_user_id ?? ''}
                  onChange={(e) => handlePriorityChange(e.target.value || null)}
                  disabled={saving}
                >
                  <option value="">None</option>
                  {priorityCandidates.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {displayName(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {isCreator && (
            <div className="chat-group-settings-section chat-group-settings-danger-zone">
              <span className="chat-group-settings-label chat-group-settings-label--with-icon chat-group-settings-label--danger">
                <AlertTriangleIcon />
                <span>Danger zone</span>
              </span>
              <button
                type="button"
                className="chat-group-settings-delete-group-btn"
                onClick={handleDeleteGroup}
                disabled={saving}
                aria-label="Delete group permanently"
              >
                <TrashIcon />
                <span>Delete group permanently</span>
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
