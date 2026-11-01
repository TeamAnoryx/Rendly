'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PointsCard from '@/components/points/PointsCard';
import '../account.css';
import Link from 'next/link';
import { useCurrentUser } from '@/context/CurrentUserContext';
import {
  getProfile,
  patchProfile,
  searchUsers,
  uploadAvatar,
  type ProfileMe,
  type PatchProfilePayload,
  type SearchUser,
} from '@/services/profileApi';
import {
  getConnections,
  getConnectionInvites,
  sendConnectionInvite,
  acceptInvite,
  rejectInvite,
  disconnect,
  blockUser,
  unblockUser,
  getBlockedUsers,
  type Connection,
  type ConnectionInvite,
  type BlockedUser,
} from '@/services/connectionsApi';
import { groupsApi, type GroupListItem } from '@/services/groups';
import { INTENTS } from '@/hooks/useProfileSetup';

/* Inline section icons (premium UI) */
const IconEdit = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconSearch = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const IconMail = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
const IconUsers = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconUserX = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="17" x2="22" y1="8" y2="13" />
    <line x1="22" x2="17" y1="8" y2="13" />
  </svg>
);
const IconGroups = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="7" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    <path d="M16 21v-2a4 4 0 0 0-4-4h-1" />
  </svg>
);
const IconMessageCircle = () => (
  <svg className="dash-profile-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

/* Field and intent icons (inside inputs / buttons) */
const IconMailField = () => (
  <span className="dash-profile-field-icon" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  </span>
);
const IconBriefcase = () => (
  <span className="dash-profile-field-icon" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
      <path d="M16 12h4" />
    </svg>
  </span>
);
const IconGitHub = () => (
  <span className="dash-profile-field-icon" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  </span>
);
const IconLinkedIn = () => (
  <span className="dash-profile-field-icon" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  </span>
);
const IntentIcons: Record<string, React.ReactNode> = {
  'Light chat': (
    <svg className="dash-profile-intent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Brainstorm: (
    <svg className="dash-profile-intent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  ),
  Motivation: (
    <svg className="dash-profile-intent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-3.054 0-3 .732.731 1.5 1.5 2 2.5.5.9 1 2.5 1 4a2.5 2.5 0 0 1-4.5 2.5" />
      <path d="M14.5 10.5c.5.5 1 1.5 1 3 0 1.38-.5 2-1 3-1.072 2.143-.224 3.054 0 3 .732-.731 1.5-1.5 2-2.5 .5-.9 1-2.5 1-4a2.5 2.5 0 0 0-4.5-2.5" />
    </svg>
  ),
  Collaborate: (
    <svg className="dash-profile-intent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Networking: (
    <svg className="dash-profile-intent-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  ),
};

function formatConnectionDuration(connectedAt: string): string {
  try {
    const d = new Date(connectedAt);
    const now = new Date();
    const months = Math.floor((now.getTime() - d.getTime()) / (30 * 24 * 60 * 60 * 1000));
    if (months < 1) return 'Less than 1 month';
    if (months === 1) return '1 month';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year' : `${years} years`;
  } catch {
    return '—';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function DashboardProfilePage() {
  const { user: contextUser, refetch: refetchCurrentUser } = useCurrentUser();
  const [profile, setProfile] = useState<ProfileMe | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bio, setBio] = useState('');
  const [profession, setProfession] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inviteSending, setInviteSending] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [invites, setInvites] = useState<ConnectionInvite[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [profileGroups, setProfileGroups] = useState<GroupListItem[]>([]);
  const [profileGroupsLoading, setProfileGroupsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  // Prefill once from shared user so placeholders never show for logged-in user
  const hasPrefilledRef = React.useRef(false);
  useEffect(() => {
    if (!contextUser || hasPrefilledRef.current) return;
    hasPrefilledRef.current = true;
    setUsername(contextUser.username ?? '');
    setEmail(contextUser.email ?? '');
    setAvatarUrl(contextUser.avatar_url ?? '');
  }, [contextUser]);

  // Single load: profile + connections + groups in parallel
  useEffect(() => {
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);
    setProfileGroupsLoading(true);
    Promise.all([
      getProfile(),
      getConnections(),
      getConnectionInvites(),
      getBlockedUsers(),
      groupsApi.getGroups(),
    ])
      .then(([profileData, connList, invList, blockedList, groupsList]) => {
        if (cancelled) return;
        setProfile(profileData ?? null);
        if (profileData) {
          setUsername(profileData.username ?? '');
          setEmail(profileData.email ?? '');
          setAvatarUrl(profileData.avatar_url ?? '');
          setBio(profileData.bio ?? '');
          setProfession(profileData.profession ?? '');
          setGithubUrl(profileData.github_url ?? '');
          setLinkedinUrl(profileData.linkedin_url ?? '');
          setSelectedIntents(Array.isArray(profileData.selected_intents) ? profileData.selected_intents : []);
        }
        setConnections(connList);
        setInvites(invList);
        setBlockedUsers(blockedList);
        setProfileGroups(Array.isArray(groupsList) ? groupsList : []);
      })
      .catch(() => {
        if (!cancelled) {
          setProfileError('Couldn’t refresh. You can still edit and save.');
          setProfile(null);
          setConnections([]);
          setInvites([]);
          setBlockedUsers([]);
          setProfileGroups([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
          setConnectionsLoading(false);
          setBlockedLoading(false);
          setProfileGroupsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const [connList, invList] = await Promise.all([getConnections(), getConnectionInvites()]);
      setConnections(connList);
      setInvites(invList);
    } catch {
      setConnections([]);
      setInvites([]);
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  const fetchBlockedUsers = useCallback(async () => {
    setBlockedLoading(true);
    try {
      const list = await getBlockedUsers();
      setBlockedUsers(list);
    } catch {
      setBlockedUsers([]);
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  const handleUnblock = useCallback(
    async (userId: string) => {
      setActingId(userId);
      const result = await unblockUser(userId);
      setActingId(null);
      if (result.ok) fetchBlockedUsers();
    },
    [fetchBlockedUsers]
  );

  const handleAvatarFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setAvatarError('Please select an image (JPEG, PNG, or WebP).');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setAvatarError('Image must be 5MB or smaller.');
        return;
      }
      setAvatarError(null);
      setAvatarUploading(true);
      try {
        const { avatar_url } = await uploadAvatar(file);
        setAvatarUrl(avatar_url);
        refetchCurrentUser();
      } catch (e) {
        setAvatarError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setAvatarUploading(false);
        if (avatarInputRef.current) avatarInputRef.current.value = '';
      }
    },
    [refetchCurrentUser]
  );

  const handleSaveProfile = useCallback(async () => {
    if (!contextUser) return;
    setSaveLoading(true);
    setSaveMessage(null);
    const payload: PatchProfilePayload = {
      username: username.trim() || undefined,
      email: email.trim() || undefined,
      avatar_url: avatarUrl.trim() || null,
      bio: bio.trim() || null,
      profession: profession.trim() || null,
      github_url: githubUrl.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      selected_intents: selectedIntents.length ? selectedIntents : undefined,
    };
    const result = await patchProfile(payload);
    setSaveLoading(false);
    if (result.ok) {
      setProfile(result.user);
      refetchCurrentUser();
      setSaveMessage({ type: 'success', text: 'Profile updated.' });
      setTimeout(() => setSaveMessage(null), 3000);
    } else {
      setSaveMessage({ type: 'error', text: result.message });
    }
  }, [contextUser, refetchCurrentUser, username, email, avatarUrl, bio, profession, githubUrl, linkedinUrl, selectedIntents]);

  const toggleIntent = useCallback((intent: string) => {
    setSelectedIntents((prev) =>
      prev.includes(intent) ? prev.filter((i) => i !== intent) : prev.length < 5 ? [...prev, intent] : prev
    );
  }, []);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim().replace(/^@/, '');
    if (q.length < 2) return;
    setSearchLoading(true);
    setSearchResults([]);
    setInviteMessage(null);
    try {
      const list = await searchUsers(q);
      setSearchResults(list);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleSendInvite = useCallback(
    async (u: SearchUser) => {
      if (!u.username) return;
      setInviteSending(u.id);
      setInviteMessage(null);
      const result = await sendConnectionInvite(u.username);
      setInviteSending(null);
      if (result.ok) {
        setInviteMessage('Invite sent.');
        setSearchResults([]);
        setSearchQuery('');
        fetchConnections();
      } else {
        setInviteMessage(result.message);
      }
    },
    [fetchConnections]
  );

  const handleAcceptInvite = useCallback(
    async (inv: ConnectionInvite) => {
      setActingId(inv.id);
      const result = await acceptInvite(inv.id);
      setActingId(null);
      if (result.ok) fetchConnections();
    },
    [fetchConnections]
  );

  const handleRejectInvite = useCallback(
    async (inv: ConnectionInvite) => {
      setActingId(inv.id);
      const result = await rejectInvite(inv.id);
      setActingId(null);
      if (result.ok) fetchConnections();
    },
    [fetchConnections]
  );

  const handleDisconnect = useCallback(
    async (userId: string) => {
      setActingId(userId);
      const result = await disconnect(userId);
      setActingId(null);
      if (result.ok) fetchConnections();
    },
    [fetchConnections]
  );

  const handleBlock = useCallback(
    async (userId: string) => {
      setActingId(userId);
      const result = await blockUser(userId);
      setActingId(null);
      if (result.ok) {
        fetchConnections();
        fetchBlockedUsers();
      }
    },
    [fetchConnections, fetchBlockedUsers]
  );

  const receivedInvites = invites.filter((i) => i.direction === 'received' && i.status === 'pending');
  const sentPendingInvites = invites.filter((i) => i.direction === 'sent' && i.status === 'pending');
  const sentAcceptedInvites = invites.filter((i) => i.direction === 'sent' && i.status === 'accepted');

  // Full-page loading only when we have no user data yet; otherwise show form with prefill
  if (profileLoading && !profile && !contextUser) {
    return (
      <div className="dash-profile-root" aria-busy="true">
        <div className="dash-profile-loading">Loading profile…</div>
      </div>
    );
  }

  // Only show error-only view when we have no user data at all; otherwise show form with inline message
  if (profileError && !profile && !contextUser) {
    return (
      <div className="dash-profile-root">
        <div className="dash-profile-card">
          <p className="dash-profile-error">{profileError}</p>
        </div>
      </div>
    );
  }

  const displayName = username.trim() || contextUser?.username || 'User';
  const tagline = bio.trim() ? bio.split('\n')[0].slice(0, 80) : 'Update your profile below.';

  return (
    <div className="dash-profile-root">
      <div className="dash-profile-left">
        <div className="dash-profile-hero">
          <div className="dash-profile-hero-avatar-wrap">
            {(avatarUrl || profile?.avatar_url) ? (
              <img
                src={avatarUrl || profile?.avatar_url || ''}
                alt=""
                className="dash-profile-hero-avatar"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            ) : (
              <div className="dash-profile-hero-avatar dash-profile-hero-avatar-placeholder" aria-hidden />
            )}
          </div>
          <h1 className="dash-profile-hero-name">@{displayName}</h1>
          <p className="dash-profile-hero-tagline">{tagline}</p>
        </div>
        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconEdit />
            Edit profile
          </h2>
          <p className="dash-profile-subtitle">Update your details. Changes are saved to your account.</p>
          {profileError && (
            <p className="dash-profile-error dash-profile-error-inline" role="alert">
              {profileError}
            </p>
          )}

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-username">
              Username
            </label>
            <input
              id="profile-username"
              type="text"
              className="dash-profile-input"
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby="profile-username-hint"
            />
          </div>

          <div className="dash-profile-field dash-profile-avatar-wrap">
            <div className="dash-profile-avatar-preview-wrap">
              {(avatarUrl || profile?.avatar_url) && (
                <img
                  src={avatarUrl || profile?.avatar_url || ''}
                  alt=""
                  className="dash-profile-avatar-preview"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
              {!avatarUrl && !profile?.avatar_url && (
                <div className="dash-profile-avatar-preview" style={{ background: '#e2e8f0' }} aria-hidden />
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                className="dash-profile-avatar-file-input"
                aria-label="Upload avatar photo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarFile(f);
                }}
                disabled={avatarUploading}
              />
              <button
                type="button"
                className="dash-profile-avatar-upload-btn"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
              >
                {avatarUploading ? 'Uploading…' : 'Upload photo'}
              </button>
            </div>
            <div className="dash-profile-field" style={{ flex: 1 }}>
              <label className="dash-profile-label" htmlFor="profile-avatar">
                Or paste image URL
              </label>
              <input
                id="profile-avatar"
                type="url"
                className="dash-profile-input"
                placeholder="https://…"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
              {avatarError && (
                <p className="dash-profile-error dash-profile-avatar-error" role="alert">
                  {avatarError}
                </p>
              )}
            </div>
          </div>

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-email">
              Email
            </label>
            <div className="dash-profile-input-wrap">
              <IconMailField />
              <input
                id="profile-email"
                type="email"
                className="dash-profile-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-bio">
              Bio
            </label>
            <textarea
              id="profile-bio"
              className="dash-profile-input dash-profile-textarea"
              placeholder="A short bio…"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-profession">
              Profession
            </label>
            <div className="dash-profile-input-wrap">
              <IconBriefcase />
              <input
                id="profile-profession"
                type="text"
                className="dash-profile-input"
                placeholder="e.g. Developer, Designer"
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
              />
            </div>
          </div>

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-github">
              GitHub URL
            </label>
            <div className="dash-profile-input-wrap">
              <IconGitHub />
              <input
                id="profile-github"
                type="url"
                className="dash-profile-input"
                placeholder="https://github.com/…"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="dash-profile-field">
            <label className="dash-profile-label" htmlFor="profile-linkedin">
              LinkedIn URL
            </label>
            <div className="dash-profile-input-wrap">
              <IconLinkedIn />
              <input
                id="profile-linkedin"
                type="url"
                className="dash-profile-input"
                placeholder="https://linkedin.com/in/…"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="dash-profile-field">
            <span className="dash-profile-label">Intents</span>
            <p className="dash-profile-subtitle" style={{ marginBottom: '0.5rem' }}>
              What you’re open to (select up to 5).
            </p>
            <div className="dash-profile-intents" role="group" aria-label="Intents">
              {INTENTS.map((intent) => (
                <button
                  key={intent}
                  type="button"
                  className={`dash-profile-intent-btn ${selectedIntents.includes(intent) ? 'selected' : ''}`}
                  onClick={() => toggleIntent(intent)}
                >
                  {IntentIcons[intent] ?? null}
                  <span>{intent}</span>
                </button>
              ))}
            </div>
          </div>

          {saveMessage && (
            <p
              className={`dash-profile-save-message ${saveMessage.type === 'success' ? 'dash-profile-success' : 'dash-profile-error'}`}
              role="status"
              aria-live="polite"
            >
              {saveMessage.text}
            </p>
          )}
          <button
            type="button"
            className="dash-profile-submit"
            onClick={handleSaveProfile}
            disabled={saveLoading}
          >
            {saveLoading ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>

      <div className="dash-profile-right">
        <PointsCard />
        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconSearch />
            Find people
          </h2>
          <p className="dash-profile-subtitle">Search by username and send a connection invite.</p>
          <div className="dash-profile-search-wrap">
            <input
              type="text"
              className="dash-profile-search-input"
              placeholder="@username"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              aria-label="Search by username"
            />
            <button
              type="button"
              className="dash-profile-search-btn"
              onClick={handleSearch}
              disabled={searchLoading || searchQuery.trim().length < 2}
            >
              {searchLoading ? '…' : 'Search'}
            </button>
          </div>
          {inviteMessage && (
            <p className="dash-profile-error" role="alert" aria-live="polite">
              {inviteMessage}
            </p>
          )}
          {searchResults.length > 0 && (
            <ul className="dash-profile-search-list" aria-label="Search results">
              {searchResults.map((u) => (
                <li key={u.id} className="dash-profile-invite-item">
                  <div className="dash-profile-invite-user">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="dash-profile-connection-avatar" />
                    ) : (
                      <div className="dash-profile-connection-avatar" style={{ background: '#e2e8f0' }} />
                    )}
                    <span className="dash-profile-connection-name">@{u.username ?? u.id}</span>
                  </div>
                  <button
                    type="button"
                    className="dash-profile-invite-accept"
                    onClick={() => handleSendInvite(u)}
                    disabled={inviteSending === u.id}
                  >
                    {inviteSending === u.id ? 'Sending…' : 'Send invite'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconMail />
            Connection invites
          </h2>
          {connectionsLoading ? (
            <p className="dash-profile-stub-text">Loading…</p>
          ) : (
            <>
              {receivedInvites.length > 0 && (
                <ul aria-label="Pending invites to you">
                  {receivedInvites.map((inv) => (
                    <li key={inv.id} className="dash-profile-invite-item">
                      <div className="dash-profile-invite-user">
                        {inv.other_user.avatar_url ? (
                          <img src={inv.other_user.avatar_url} alt="" className="dash-profile-connection-avatar" />
                        ) : (
                          <div className="dash-profile-connection-avatar" style={{ background: '#e2e8f0' }} />
                        )}
                        <span className="dash-profile-connection-name">@{inv.other_user.username ?? inv.other_user.id}</span>
                      </div>
                      <div className="dash-profile-invite-actions">
                        <button
                          type="button"
                          className="dash-profile-invite-accept"
                          onClick={() => handleAcceptInvite(inv)}
                          disabled={actingId === inv.id}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="dash-profile-invite-reject"
                          onClick={() => handleRejectInvite(inv)}
                          disabled={actingId === inv.id}
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {sentPendingInvites.length > 0 && (
                <div className="dash-profile-invite-status-list" aria-label="Sent invites waiting for response">
                  {sentPendingInvites.map((inv) => {
                    const name = inv.other_user.username ?? inv.other_user.id;
                    return (
                      <div key={inv.id} className="dash-profile-invite-status-box dash-profile-invite-status-box--waiting">
                        Waiting for @{name} to accept
                      </div>
                    );
                  })}
                </div>
              )}
              {sentAcceptedInvites.length > 0 && (
                <div className="dash-profile-invite-status-list" aria-label="Invites accepted by others">
                  {sentAcceptedInvites.map((inv) => {
                    const name = inv.other_user.username ?? inv.other_user.id;
                    return (
                      <div key={inv.id} className="dash-profile-invite-status-box dash-profile-invite-status-box--accepted">
                        Accepted by @{name}
                      </div>
                    );
                  })}
                </div>
              )}
              {receivedInvites.length === 0 && sentPendingInvites.length === 0 && sentAcceptedInvites.length === 0 && (
                <p className="dash-profile-empty">No pending invites.</p>
              )}
            </>
          )}
        </div>

        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconUsers />
            Connections
          </h2>
          <p className="dash-profile-subtitle">
            {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
          </p>
          {connectionsLoading ? (
            <p className="dash-profile-stub-text">Loading…</p>
          ) : connections.length === 0 ? (
            <p className="dash-profile-empty">No connections yet. Search above to invite someone.</p>
          ) : (
            <ul aria-label="Your connections">
              {connections.map((c) => (
                <li key={c.id} className={`dash-profile-connection-item${expandedId === c.id ? ' expanded' : ''}`}>
                  <button
                    type="button"
                    className="dash-profile-connection-header"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    aria-expanded={expandedId === c.id}
                  >
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" className="dash-profile-connection-avatar" />
                    ) : (
                      <div className="dash-profile-connection-avatar" style={{ background: '#e2e8f0' }} />
                    )}
                    <div className="dash-profile-connection-meta">
                      <span className="dash-profile-connection-name">@{c.username ?? c.id}</span>
                      <span className="dash-profile-connection-date">Connected since {formatDate(c.connected_at)}</span>
                    </div>
                    <span className="dash-profile-connection-chevron" aria-hidden>
                      ▼
                    </span>
                  </button>
                  {expandedId === c.id && (
                    <div className="dash-profile-connection-detail">
                      <p className="dash-profile-stub-text">
                        Duration: {formatConnectionDuration(c.connected_at)}
                      </p>
                      <p className="dash-profile-stub-text">In your groups / huddles: —</p>
                      <div className="dash-profile-connection-actions">
                        <button
                          type="button"
                          className="dash-profile-btn-disconnect"
                          onClick={() => handleDisconnect(c.id)}
                          disabled={actingId === c.id}
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          className="dash-profile-btn-block"
                          onClick={() => handleBlock(c.id)}
                          disabled={actingId === c.id}
                        >
                          Block
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconUserX />
            Blocked users
          </h2>
          <p className="dash-profile-subtitle">
            {blockedUsers.length} {blockedUsers.length === 1 ? 'user' : 'users'} blocked
          </p>
          {blockedLoading ? (
            <p className="dash-profile-stub-text">Loading…</p>
          ) : blockedUsers.length === 0 ? (
            <p className="dash-profile-empty">No blocked users.</p>
          ) : (
            <ul aria-label="Blocked users">
              {blockedUsers.map((b) => (
                <li key={b.id} className="dash-profile-connection-item">
                  <div className="dash-profile-connection-header" style={{ cursor: 'default' }}>
                    {b.avatar_url ? (
                      <img src={b.avatar_url} alt="" className="dash-profile-connection-avatar" />
                    ) : (
                      <div className="dash-profile-connection-avatar" style={{ background: '#e2e8f0' }} />
                    )}
                    <div className="dash-profile-connection-meta">
                      <span className="dash-profile-connection-name">@{b.username ?? b.id}</span>
                    </div>
                    <button
                      type="button"
                      className="dash-profile-btn-disconnect"
                      onClick={() => handleUnblock(b.id)}
                      disabled={actingId === b.id}
                      style={{ marginLeft: 'auto' }}
                    >
                      {actingId === b.id ? '…' : 'Unblock'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconGroups />
            Groups
          </h2>
          <p className="dash-profile-subtitle">
            {profileGroups.length} {profileGroups.length === 1 ? 'active group' : 'active groups'}
          </p>
          {profileGroupsLoading ? (
            <p className="dash-profile-stub-text">Loading…</p>
          ) : profileGroups.length === 0 ? (
            <p className="dash-profile-empty">No groups yet. Create or join a group from the Whisper tab.</p>
          ) : (
            <ul aria-label="Your groups">
              {profileGroups.map((g) => (
                <li key={g.id} className="dash-profile-connection-item">
                  <div className="dash-profile-connection-header" style={{ cursor: 'default' }}>
                    {g.avatar_url ? (
                      <img src={g.avatar_url} alt="" className="dash-profile-connection-avatar" />
                    ) : (
                      <div className="dash-profile-connection-avatar" style={{ background: '#e2e8f0' }} aria-hidden />
                    )}
                    <div className="dash-profile-connection-meta">
                      <span className="dash-profile-connection-name">{g.name || 'Unnamed group'}</span>
                    </div>
                    <Link
                      href="/dashboard/chat?tab=Group"
                      className="dash-profile-invite-accept"
                      style={{ marginLeft: 'auto', textDecoration: 'none' }}
                    >
                      Open in Chat
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-profile-card dash-profile-card-interactive">
          <h2 className="dash-profile-title-with-icon">
            <IconMessageCircle />
            Huddles
          </h2>
          <p className="dash-profile-stub-text">Huddles you hosted: 0</p>
          <p className="dash-profile-stub-text">Public huddles you joined: 0</p>
        </div>
      </div>
    </div>
  );
}
