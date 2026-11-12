'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PointsCard from '@/components/points/PointsCard';
import '../account.css';
import Link from 'next/link';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { Avatar } from '@/components/shell/AppShell';
import { getMyPoints } from '@/services/pointsApi';
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

/* 16px stroke icons, inherit currentColor */
function Svg({ children, className = 'acct-icon' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const IconUser = () => (
  <Svg>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);
const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
const IconMail = () => (
  <Svg>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </Svg>
);
const IconUsers = () => (
  <Svg>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);
const IconUserX = () => (
  <Svg>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="m17 8 5 5M22 8l-5 5" />
  </Svg>
);
const IconHash = () => (
  <Svg>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </Svg>
);
const IconMessage = () => (
  <Svg>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);
const IconTarget = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
);
const IconLink = () => (
  <Svg>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);
const IconBriefcase = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <rect width="20" height="14" x="2" y="7" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </Svg>
);
const IconCamera = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);
const IconChevron = () => (
  <Svg className="acct-chevron">
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
const IconGitHub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);
const IconLinkedIn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);
const IconMailGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const intentPath = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const IntentIcons: Record<string, React.ReactNode> = {
  'Light chat': intentPath(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  Brainstorm: intentPath(
    <>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6M10 22h4" />
    </>
  ),
  Motivation: intentPath(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />),
  Collaborate: intentPath(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  Networking: intentPath(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
    </>
  ),
};

const MAX_INTENTS = 5;
const BIO_MAX = 500;

/** Section header used by every panel on this page. */
function SectionHead({
  icon,
  title,
  desc,
  aside,
  id,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="acct-section-head">
      <div>
        <h2 className="acct-section-title" id={id}>
          {icon}
          {title}
        </h2>
        {desc ? <p className="acct-section-desc">{desc}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/** Label/description left, control right. */
function Row({
  label,
  desc,
  htmlFor,
  top,
  children,
}: {
  label: React.ReactNode;
  desc?: React.ReactNode;
  htmlFor?: string;
  top?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`acct-row${top ? ' acct-row--top' : ''}`}>
      <div className="acct-row-text">
        {htmlFor ? (
          <label className="acct-row-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="acct-row-label">{label}</span>
        )}
        {desc ? <p className="acct-row-desc">{desc}</p> : null}
      </div>
      <div className="acct-row-control">{children}</div>
    </div>
  );
}

function ListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="acct-skeleton-rows" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rd-skeleton" />
      ))}
    </div>
  );
}

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


  // Header stats: read-only points summary (the shell and PointsCard read the same endpoint).
  const [pointsTotal, setPointsTotal] = useState<number | null>(null);
  const [pointsRank, setPointsRank] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    getMyPoints()
      .then((p) => {
        if (!alive) return;
        setPointsTotal(p.total);
        setPointsRank(p.rank);
      })
      .catch(() => {
        /* stats stay as "—"; PointsCard shows its own error */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Full-page loading only when we have no user data yet; otherwise show form with prefill
  if (profileLoading && !profile && !contextUser) {
    return (
      <div className="pf-root" aria-busy="true">
        <div className="pf-loading">
          <span className="rd-spinner rd-spinner--lg" aria-hidden />
          Loading profile…
        </div>
      </div>
    );
  }

  // Only show error-only view when we have no user data at all; otherwise show form with inline message
  if (profileError && !profile && !contextUser) {
    return (
      <div className="pf-root">
        <div className="pf-wrap">
          <div className="acct-section">
            <SectionHead icon={<IconUser />} title="Profile" />
            <div className="acct-empty">
              <span className="acct-msg acct-msg--error" role="alert">
                {profileError}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayName = username.trim() || contextUser?.username || 'User';
  const heroAvatar = avatarUrl || profile?.avatar_url || '';
  const initials = displayName.replace(/^@/, '').slice(0, 2).toUpperCase();
  const fmt = (n: number) => n.toLocaleString('en-IN');

  return (
    <div className="pf-root">
      <div className="pf-wrap">
        {/* ---------- Header band ---------- */}
        <header className="pf-header rd-card">
          <div className="pf-header-main">
            <button
              type="button"
              className={`pf-avatar${avatarUploading ? ' pf-avatar--busy' : ''}`}
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              aria-label={avatarUploading ? 'Uploading photo' : 'Change profile photo'}
            >
              {heroAvatar ? (
                <img src={heroAvatar} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
              ) : (
                <span className="pf-avatar-initials" aria-hidden>
                  {initials}
                </span>
              )}
              <span className="pf-avatar-overlay" aria-hidden>
                {avatarUploading ? <span className="rd-spinner" /> : <IconCamera />}
                {!avatarUploading && <span>Change</span>}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              className="pf-file"
              tabIndex={-1}
              aria-label="Upload avatar photo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAvatarFile(f);
              }}
              disabled={avatarUploading}
            />

            <div className="pf-identity">
              <h1 className="rd-h1 pf-name">{displayName.replace(/^@/, '')}</h1>
              <p className="pf-handle rd-mono">@{displayName.replace(/^@/, '')}</p>
              {profession.trim() ? (
                <p className="pf-profession">
                  <IconBriefcase className="acct-icon" />
                  {profession.trim()}
                </p>
              ) : null}
              <p className={`pf-bio${bio.trim() ? '' : ' pf-bio--empty'}`}>
                {bio.trim() || 'No bio yet. Add one below so people know what you are about.'}
              </p>
              {selectedIntents.length > 0 ? (
                <ul className="pf-chips" aria-label="Your intents">
                  {selectedIntents.map((intent) => (
                    <li key={intent} className="pf-chip">
                      {IntentIcons[intent] ?? null}
                      {intent}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {avatarError ? (
            <p className="acct-msg acct-msg--error pf-header-error" role="alert">
              {avatarError}
            </p>
          ) : null}

          <div className="pf-stats">
            <a href="#rankings" className="pf-stat">
              <span className="pf-stat-label">Points</span>
              <span className="pf-stat-value">{pointsTotal === null ? '—' : fmt(pointsTotal)}</span>
            </a>
            <div className="pf-stat">
              <span className="pf-stat-label">Connections</span>
              <span className="pf-stat-value">{connectionsLoading ? '—' : fmt(connections.length)}</span>
            </div>
            <a href="#rankings" className="pf-stat">
              <span className="pf-stat-label">Rank</span>
              <span className="pf-stat-value">{pointsRank ? `#${fmt(pointsRank)}` : '—'}</span>
            </a>
            <div className="pf-stat">
              <span className="pf-stat-label">Groups</span>
              <span className="pf-stat-value">{profileGroupsLoading ? '—' : fmt(profileGroups.length)}</span>
            </div>
          </div>
        </header>

        <div className="pf-grid">
          {/* ---------- Main column: editable profile + people ---------- */}
          <div className="pf-col">
            <section className="acct-section" aria-labelledby="pf-about">
              <SectionHead
                id="pf-about"
                icon={<IconUser />}
                title="About"
                desc="How you appear to people you meet on Rendly."
              />
              {profileError ? (
                <p className="acct-banner acct-msg acct-msg--error" role="alert">
                  {profileError}
                </p>
              ) : null}

              <Row label="Username" desc="Your unique handle." htmlFor="profile-username">
                <span className="acct-affix">
                  <span className="acct-affix-glyph" aria-hidden>
                    @
                  </span>
                  <input
                    id="profile-username"
                    type="text"
                    className="rd-input"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                  />
                </span>
              </Row>

              <Row label="Email" desc="Used for sign-in and account notices." htmlFor="profile-email">
                <span className="acct-affix">
                  <span className="acct-affix-glyph" aria-hidden>
                    <IconMailGlyph />
                  </span>
                  <input
                    id="profile-email"
                    type="email"
                    className="rd-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </span>
              </Row>

              <Row label="Profession" desc="What you do, in a few words." htmlFor="profile-profession">
                <input
                  id="profile-profession"
                  type="text"
                  className="rd-input"
                  placeholder="e.g. Developer, Designer"
                  value={profession}
                  onChange={(e) => setProfession(e.target.value)}
                />
              </Row>

              <Row label="Bio" desc="A short introduction. The first lines show on your card." htmlFor="profile-bio" top>
                <span className="acct-field">
                  <textarea
                    id="profile-bio"
                    className="rd-textarea"
                    placeholder="A short bio…"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={BIO_MAX}
                  />
                  <span className="acct-field-meta">
                    {bio.length}/{BIO_MAX}
                  </span>
                </span>
              </Row>

              <Row label="Photo" desc="JPEG, PNG or WebP, up to 5 MB. Or paste an image URL." htmlFor="profile-avatar" top>
                <span className="acct-field">
                  <span className="pf-photo">
                    <Avatar url={heroAvatar || null} name={displayName} />
                    <button
                      type="button"
                      className="rd-btn rd-btn--sm"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      {avatarUploading ? (
                        <>
                          <span className="rd-spinner acct-btn-spinner" aria-hidden />
                          Uploading…
                        </>
                      ) : (
                        'Upload photo'
                      )}
                    </button>
                  </span>
                  <input
                    id="profile-avatar"
                    type="url"
                    className="rd-input"
                    placeholder="https://…"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                  />
                </span>
              </Row>
            </section>

            <section className="acct-section" aria-labelledby="pf-intents">
              <SectionHead
                id="pf-intents"
                icon={<IconTarget />}
                title="Intents"
                desc="What you are open to. Used to match you with the right people."
                aside={
                  <span className="acct-count">
                    {selectedIntents.length}/{MAX_INTENTS}
                  </span>
                }
              />
              <div className="pf-intents" role="group" aria-labelledby="pf-intents">
                {INTENTS.map((intent) => {
                  const on = selectedIntents.includes(intent);
                  return (
                    <button
                      key={intent}
                      type="button"
                      className={`rd-chip${on ? ' rd-chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleIntent(intent)}
                      disabled={!on && selectedIntents.length >= MAX_INTENTS}
                    >
                      {IntentIcons[intent] ?? null}
                      {intent}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="acct-section" aria-labelledby="pf-links">
              <SectionHead id="pf-links" icon={<IconLink />} title="Links" desc="Shown on your profile card." />
              <Row label="GitHub" htmlFor="profile-github">
                <span className="acct-affix">
                  <span className="acct-affix-glyph" aria-hidden>
                    <IconGitHub />
                  </span>
                  <input
                    id="profile-github"
                    type="url"
                    className="rd-input"
                    placeholder="https://github.com/…"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                  />
                </span>
              </Row>
              <Row label="LinkedIn" htmlFor="profile-linkedin">
                <span className="acct-affix">
                  <span className="acct-affix-glyph" aria-hidden>
                    <IconLinkedIn />
                  </span>
                  <input
                    id="profile-linkedin"
                    type="url"
                    className="rd-input"
                    placeholder="https://linkedin.com/in/…"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                  />
                </span>
              </Row>
            </section>

            <div className="pf-savebar">
              {saveMessage ? (
                <span
                  className={`acct-msg ${saveMessage.type === 'success' ? 'acct-msg--success' : 'acct-msg--error'}`}
                  role="status"
                  aria-live="polite"
                >
                  {saveMessage.text}
                </span>
              ) : (
                <span className="pf-savebar-hint">Changes to About, Intents and Links are saved together.</span>
              )}
              <button type="button" className="rd-btn rd-btn--primary" onClick={handleSaveProfile} disabled={saveLoading}>
                {saveLoading ? (
                  <>
                    <span className="rd-spinner acct-btn-spinner" aria-hidden />
                    Saving…
                  </>
                ) : (
                  'Save profile'
                )}
              </button>
            </div>

            <section className="acct-section" aria-labelledby="pf-connections">
              <SectionHead
                id="pf-connections"
                icon={<IconUsers />}
                title="Connections"
                aside={<span className="acct-count">{connectionsLoading ? '—' : connections.length}</span>}
              />
              {connectionsLoading ? (
                <ListSkeleton rows={3} />
              ) : connections.length === 0 ? (
                <p className="acct-empty">No connections yet. Use Find people to invite someone.</p>
              ) : (
                <ul className="acct-list" aria-label="Your connections">
                  {connections.map((c) => {
                    const open = expandedId === c.id;
                    return (
                      <li key={c.id} className={`acct-list-item${open ? ' acct-list-item--open' : ''}`}>
                        <button
                          type="button"
                          className="acct-person"
                          onClick={() => setExpandedId(open ? null : c.id)}
                          aria-expanded={open}
                        >
                          <Avatar url={c.avatar_url} name={c.username ?? c.id} />
                          <span className="acct-person-meta">
                            <span className="acct-person-name">@{c.username ?? c.id}</span>
                            <span className="acct-person-sub">Connected {formatDate(c.connected_at)}</span>
                          </span>
                          <IconChevron />
                        </button>
                        {open && (
                          <div className="acct-detail">
                            <dl className="acct-kv">
                              <dt>Connected for</dt>
                              <dd>{formatConnectionDuration(c.connected_at)}</dd>
                              <dt>Shared groups / huddles</dt>
                              <dd>—</dd>
                            </dl>
                            <div className="acct-person-actions">
                              <button
                                type="button"
                                className="rd-btn rd-btn--sm"
                                onClick={() => handleDisconnect(c.id)}
                                disabled={actingId === c.id}
                              >
                                Disconnect
                              </button>
                              <button
                                type="button"
                                className="rd-btn rd-btn--sm rd-btn--danger"
                                onClick={() => handleBlock(c.id)}
                                disabled={actingId === c.id}
                              >
                                Block
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="acct-section" aria-labelledby="pf-invites">
              <SectionHead id="pf-invites" icon={<IconMail />} title="Connection invites" />
              {connectionsLoading ? (
                <ListSkeleton rows={2} />
              ) : (
                <>
                  {receivedInvites.length > 0 && (
                    <ul className="acct-list" aria-label="Pending invites to you">
                      {receivedInvites.map((inv) => (
                        <li key={inv.id} className="acct-list-item">
                          <div className="acct-person">
                            <Avatar url={inv.other_user.avatar_url} name={inv.other_user.username ?? inv.other_user.id} />
                            <span className="acct-person-meta">
                              <span className="acct-person-name">@{inv.other_user.username ?? inv.other_user.id}</span>
                              <span className="acct-person-sub">Wants to connect</span>
                            </span>
                            <span className="acct-person-actions">
                              <button
                                type="button"
                                className="rd-btn rd-btn--sm rd-btn--ghost"
                                onClick={() => handleRejectInvite(inv)}
                                disabled={actingId === inv.id}
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                className="rd-btn rd-btn--sm rd-btn--primary"
                                onClick={() => handleAcceptInvite(inv)}
                                disabled={actingId === inv.id}
                              >
                                Accept
                              </button>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sentPendingInvites.length > 0 && (
                    <div aria-label="Sent invites waiting for response">
                      {sentPendingInvites.map((inv) => (
                        <div key={inv.id} className="acct-status">
                          <span className="rd-dot" aria-hidden />
                          <span className="acct-person-name">@{inv.other_user.username ?? inv.other_user.id}</span>
                          <span className="rd-badge">Pending</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {sentAcceptedInvites.length > 0 && (
                    <div aria-label="Invites accepted by others">
                      {sentAcceptedInvites.map((inv) => (
                        <div key={inv.id} className="acct-status">
                          <span className="rd-dot" style={{ background: 'var(--rd-success)' }} aria-hidden />
                          <span className="acct-person-name">@{inv.other_user.username ?? inv.other_user.id}</span>
                          <span className="rd-badge rd-badge--success">Accepted</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {receivedInvites.length === 0 && sentPendingInvites.length === 0 && sentAcceptedInvites.length === 0 && (
                    <p className="acct-empty">No pending invites.</p>
                  )}
                </>
              )}
            </section>
          </div>

          {/* ---------- Side column ---------- */}
          <aside className="pf-col" aria-label="Rankings and people">
            <PointsCard />

            <section className="acct-section" aria-labelledby="pf-find">
              <SectionHead
                id="pf-find"
                icon={<IconSearch />}
                title="Find people"
                desc="Search by username and send a connection invite."
              />
              <div className="pf-search">
                <span className="acct-affix">
                  <span className="acct-affix-glyph" aria-hidden>
                    @
                  </span>
                  <input
                    type="text"
                    className="rd-input"
                    placeholder="username"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    aria-label="Search by username"
                  />
                </span>
                <button
                  type="button"
                  className="rd-btn"
                  onClick={handleSearch}
                  disabled={searchLoading || searchQuery.trim().length < 2}
                >
                  {searchLoading ? <span className="rd-spinner acct-btn-spinner" aria-label="Searching" /> : 'Search'}
                </button>
              </div>
              {inviteMessage && (
                <p className="acct-banner acct-msg" role="alert" aria-live="polite">
                  {inviteMessage}
                </p>
              )}
              {searchResults.length > 0 && (
                <ul className="acct-list" aria-label="Search results">
                  {searchResults.map((u) => (
                    <li key={u.id} className="acct-list-item">
                      <div className="acct-person">
                        <Avatar url={u.avatar_url} name={u.username ?? u.id} />
                        <span className="acct-person-meta">
                          <span className="acct-person-name">@{u.username ?? u.id}</span>
                        </span>
                        <button
                          type="button"
                          className="rd-btn rd-btn--sm"
                          onClick={() => handleSendInvite(u)}
                          disabled={inviteSending === u.id}
                        >
                          {inviteSending === u.id ? 'Sending…' : 'Invite'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="acct-section" aria-labelledby="pf-groups">
              <SectionHead
                id="pf-groups"
                icon={<IconHash />}
                title="Groups"
                aside={<span className="acct-count">{profileGroupsLoading ? '—' : profileGroups.length}</span>}
              />
              {profileGroupsLoading ? (
                <ListSkeleton rows={2} />
              ) : profileGroups.length === 0 ? (
                <p className="acct-empty">No groups yet. Create or join one from Whispers.</p>
              ) : (
                <ul className="acct-list" aria-label="Your groups">
                  {profileGroups.map((g) => (
                    <li key={g.id} className="acct-list-item">
                      <div className="acct-person">
                        <Avatar url={g.avatar_url} name={g.name || 'Group'} />
                        <span className="acct-person-meta">
                          <span className="acct-person-name">{g.name || 'Unnamed group'}</span>
                        </span>
                        <Link href="/dashboard/chat?tab=Group" className="rd-btn rd-btn--sm rd-btn--ghost">
                          Open
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="acct-section" aria-labelledby="pf-blocked">
              <SectionHead
                id="pf-blocked"
                icon={<IconUserX />}
                title="Blocked users"
                aside={<span className="acct-count">{blockedLoading ? '—' : blockedUsers.length}</span>}
              />
              {blockedLoading ? (
                <ListSkeleton rows={1} />
              ) : blockedUsers.length === 0 ? (
                <p className="acct-empty">No blocked users.</p>
              ) : (
                <ul className="acct-list" aria-label="Blocked users">
                  {blockedUsers.map((b) => (
                    <li key={b.id} className="acct-list-item">
                      <div className="acct-person">
                        <Avatar url={b.avatar_url} name={b.username ?? b.id} />
                        <span className="acct-person-meta">
                          <span className="acct-person-name">@{b.username ?? b.id}</span>
                        </span>
                        <button
                          type="button"
                          className="rd-btn rd-btn--sm"
                          onClick={() => handleUnblock(b.id)}
                          disabled={actingId === b.id}
                        >
                          {actingId === b.id ? 'Unblocking…' : 'Unblock'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="acct-section" aria-labelledby="pf-huddles">
              <SectionHead id="pf-huddles" icon={<IconMessage />} title="Huddles" />
              <dl className="pf-mini-stats">
                <div>
                  <dt>Hosted</dt>
                  <dd>0</dd>
                </div>
                <div>
                  <dt>Public joined</dt>
                  <dd>0</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
