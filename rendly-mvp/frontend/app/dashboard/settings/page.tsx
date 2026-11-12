'use client';

import React, { useCallback, useEffect, useState } from 'react';
import '../account.css';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getBlockedUsers,
  unblockUser,
  type BlockedUser,
} from '@/services/connectionsApi';
import { searchUsers, type SearchUser } from '@/services/profileApi';
import {
  getSettings,
  patchSettings,
  submitReport,
  submitContact,
  deleteAccount,
  type UserSettings,
  type ReportType,
} from '@/services/settingsApi';
import { clearAuthStorage } from '@/lib/auth-storage';
import { LegalContentRenderer } from '@/components/legal/LegalContentRenderer';
import { TERMS_SECTIONS, PRIVACY_SECTIONS, USER_POLICY_SECTIONS } from '@/content/legalContent';
import { Avatar } from '@/components/shell/AppShell';

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

const ICONS = {
  account: (
    <Svg>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  ),
  privacy: (
    <Svg>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Svg>
  ),
  notifications: (
    <Svg>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  ),
  report: (
    <Svg>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </Svg>
  ),
  contact: (
    <Svg>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Svg>
  ),
  legal: (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </Svg>
  ),
  block: (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93 19.07 19.07" />
    </Svg>
  ),
  danger: (
    <Svg>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  plus: (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  minus: (
    <Svg>
      <path d="M5 12h14" />
    </Svg>
  ),
};

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
];

type PermissionItem = { key: keyof UserSettings; label: string; description: string };

const PRIVACY_ITEMS: PermissionItem[] = [
  { key: 'camera_allowed', label: 'Camera', description: 'Allow access to your camera' },
  { key: 'microphone_allowed', label: 'Microphone', description: 'Allow access to your microphone' },
  { key: 'location_allowed', label: 'Location', description: 'Share your location when needed' },
  { key: 'popups_redirects_allowed', label: 'Pop-ups & redirects', description: 'Allow pop-ups and redirects' },
  { key: 'auto_verify', label: 'Auto-verify', description: 'Automatically verify your identity' },
  { key: 'on_device_site_data', label: 'On-device site data', description: 'Store data on this device' },
];

const NOTIFICATION_ITEMS: PermissionItem[] = [
  { key: 'notifications_allowed', label: 'Notifications', description: 'Receive push and in-app notifications' },
  { key: 'sound_allowed', label: 'Sound', description: 'Play sounds for messages and calls' },
];

const SETTINGS_TABS = [
  { id: 'account', label: 'Account', group: 'Account', desc: 'Your profile, blocked people and account lifecycle.' },
  { id: 'privacy', label: 'Privacy', group: 'Account', desc: 'Control what Rendly can access on this device.' },
  { id: 'notifications', label: 'Notifications', group: 'Account', desc: 'Choose how Rendly gets your attention.' },
  { id: 'report', label: 'Report', group: 'Support', desc: 'Report harassment, fraud, spam or other concerning activity.' },
  { id: 'contact', label: 'Contact us', group: 'Support', desc: 'Send us a message and we will respond as soon as we can.' },
  { id: 'legal', label: 'Terms & policy', group: 'Support', desc: 'The same terms you agreed to at sign-up.' },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

const LEGAL_DOCS = [
  { id: 'terms', title: 'Terms of Service', sections: TERMS_SECTIONS },
  { id: 'privacy', title: 'Privacy Policy', sections: PRIVACY_SECTIONS },
  { id: 'user', title: 'User Policy', sections: USER_POLICY_SECTIONS },
] as const;

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

function Row({
  label,
  desc,
  htmlFor,
  top,
  inline,
  children,
}: {
  label: React.ReactNode;
  desc?: React.ReactNode;
  htmlFor?: string;
  top?: boolean;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`acct-row${top ? ' acct-row--top' : ''}${inline ? ' acct-row--inline' : ''}`}>
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

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('account');
  const router = useRouter();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [reportType, setReportType] = useState<ReportType>('other');
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMessage, setReportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reportUserQuery, setReportUserQuery] = useState('');
  const [reportUserResults, setReportUserResults] = useState<SearchUser[]>([]);
  const [reportUserSearching, setReportUserSearching] = useState(false);
  const [reportSelectedUser, setReportSelectedUser] = useState<SearchUser | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactMessageResult, setContactMessageResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [legalAccordionOpen, setLegalAccordionOpen] = useState<'terms' | 'privacy' | 'user' | null>(null);

  const loadBlocked = useCallback(async () => {
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

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await getSettings();
      setSettings(data);
    } catch {
      setSettings(null);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlocked();
    loadSettings();
  }, [loadBlocked, loadSettings]);

  const handleUnblock = useCallback(async (userId: string) => {
    setUnblockingId(userId);
    const result = await unblockUser(userId);
    setUnblockingId(null);
    if (result.ok) loadBlocked();
  }, [loadBlocked]);

  const handleToggleSetting = useCallback(async (key: keyof UserSettings, value: boolean) => {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    const result = await patchSettings({ [key]: value });
    if (!result.ok) setSettings(settings);
  }, [settings]);

  const handleReportUserSearch = useCallback(async () => {
    const q = reportUserQuery.trim().replace(/^@/, '');
    if (q.length < 2) {
      setReportUserResults([]);
      return;
    }
    setReportUserSearching(true);
    setReportUserResults([]);
    try {
      const list = await searchUsers(q);
      setReportUserResults(list);
    } finally {
      setReportUserSearching(false);
    }
  }, [reportUserQuery]);

  const handleSubmitReport = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setReportSubmitting(true);
    setReportMessage(null);
    const result = await submitReport({
      type: reportType,
      description: reportDescription.trim() || undefined,
      target_user_id: reportSelectedUser?.id,
      target_type: reportSelectedUser ? 'user' : undefined,
    });
    setReportSubmitting(false);
    if (result.ok) {
      setReportMessage({ type: 'success', text: 'Report submitted. We will review it shortly.' });
      setReportDescription('');
      setReportSelectedUser(null);
      setReportUserQuery('');
      setReportUserResults([]);
    } else {
      setReportMessage({ type: 'error', text: result.message });
    }
  }, [reportType, reportDescription, reportSelectedUser]);

  const handleSubmitContact = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
      setContactMessageResult({ type: 'error', text: 'Please fill in name, email, and message.' });
      return;
    }
    setContactSubmitting(true);
    setContactMessageResult(null);
    const result = await submitContact({ name: contactName.trim(), email: contactEmail.trim(), message: contactMessage.trim() });
    setContactSubmitting(false);
    if (result.ok) {
      setContactMessageResult({ type: 'success', text: 'Message sent. We will get back to you soon.' });
      setContactName('');
      setContactEmail('');
      setContactMessage('');
    } else {
      setContactMessageResult({ type: 'error', text: result.message });
    }
  }, [contactName, contactEmail, contactMessage]);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText.toLowerCase() !== 'delete') return;
    setDeleteError(null);
    setDeleteSubmitting(true);
    const result = await deleteAccount();
    setDeleteSubmitting(false);
    if (result.ok) {
      clearAuthStorage();
      setDeleteConfirmOpen(false);
      setDeleteConfirmText('');
      router.push('/login');
      return;
    }
    setDeleteError(result.message);
  }, [deleteConfirmText, router]);


  const activeTab = SETTINGS_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0];

  const renderToggles = (items: PermissionItem[], labelledBy: string) => {
    if (settingsLoading) {
      return (
        <div className="acct-skeleton-rows" aria-hidden>
          {items.map((i) => (
            <div key={i.key} className="rd-skeleton" />
          ))}
        </div>
      );
    }
    if (!settings) {
      return (
        <p className="acct-empty">
          <span className="acct-msg acct-msg--error" role="alert">
            Could not load settings.
          </span>
        </p>
      );
    }
    return (
      <div role="group" aria-labelledby={labelledBy}>
        {items.map(({ key, label, description }) => (
          <Row key={key} label={label} desc={description} inline>
            <button
              type="button"
              role="switch"
              aria-checked={!!settings[key]}
              aria-label={label}
              className="acct-switch"
              onClick={() => handleToggleSetting(key, !settings[key])}
            />
          </Row>
        ))}
      </div>
    );
  };

  let groupShown: string | null = null;

  return (
    <div className="st-root">
      <div className="st-layout">
        <nav className="st-nav" aria-label="Settings sections">
          <p className="st-nav-title">Settings</p>
          {SETTINGS_TABS.map((t) => {
            const heading =
              t.group !== groupShown ? (
                <p key={`g-${t.group}`} className="st-nav-group">
                  {t.group}
                </p>
              ) : null;
            groupShown = t.group;
            return (
              <React.Fragment key={t.id}>
                {heading}
                <button
                  type="button"
                  aria-current={tab === t.id ? 'page' : undefined}
                  className="st-nav-item"
                  onClick={() => setTab(t.id)}
                >
                  {ICONS[t.id]}
                  {t.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="st-content" key={tab}>
          <header className="st-page-head">
            <h1 className="rd-h1">{activeTab.label}</h1>
            <p className="st-page-desc">{activeTab.desc}</p>
          </header>

          {tab === 'account' && (
            <>
              <section className="acct-section" aria-labelledby="st-account">
                <SectionHead id="st-account" icon={ICONS.account} title="Profile" />
                <Row label="Public profile" desc="Name, photo, bio, intents and links.">
                  <Link href="/dashboard/profile" className="rd-btn rd-btn--sm">
                    Edit profile
                  </Link>
                </Row>
                <Row label="Points & rankings" desc="Your balance and where you stand on the leaderboard.">
                  <Link href="/dashboard/profile#rankings" className="rd-btn rd-btn--sm rd-btn--ghost">
                    View rankings
                  </Link>
                </Row>
              </section>

              <section className="acct-section" aria-labelledby="settings-blocked-heading">
                <SectionHead
                  id="settings-blocked-heading"
                  icon={ICONS.block}
                  title="Blocked users"
                  desc={
                    <>
                      Unblock people you blocked before. To block someone, open{' '}
                      <Link href="/dashboard/profile">Profile</Link> and use Connections.
                    </>
                  }
                  aside={<span className="acct-count">{blockedLoading ? '—' : blockedUsers.length}</span>}
                />
                {blockedLoading ? (
                  <div className="acct-skeleton-rows" aria-hidden>
                    <div className="rd-skeleton" />
                  </div>
                ) : blockedUsers.length === 0 ? (
                  <p className="acct-empty">No blocked users.</p>
                ) : (
                  <ul className="acct-list" aria-label="Blocked users">
                    {blockedUsers.map((u) => (
                      <li key={u.id} className="acct-list-item">
                        <div className="acct-person">
                          <Avatar url={u.avatar_url} name={u.username ?? u.id} />
                          <span className="acct-person-meta">
                            <span className="acct-person-name">@{u.username ?? u.id.slice(0, 8)}</span>
                          </span>
                          <button
                            type="button"
                            className="rd-btn rd-btn--sm"
                            onClick={() => handleUnblock(u.id)}
                            disabled={unblockingId === u.id}
                          >
                            {unblockingId === u.id ? 'Unblocking…' : 'Unblock'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="acct-section acct-section--danger" aria-labelledby="settings-delete-heading">
                <SectionHead id="settings-delete-heading" icon={ICONS.danger} title="Danger zone" />
                <Row label="Delete account" desc="Permanently delete your account and all associated data. This cannot be undone.">
                  <button type="button" className="rd-btn rd-btn--danger" onClick={() => setDeleteConfirmOpen(true)}>
                    Delete my account
                  </button>
                </Row>
              </section>
            </>
          )}

          {tab === 'privacy' && (
            <section className="acct-section" aria-labelledby="settings-permissions-heading">
              <SectionHead
                id="settings-permissions-heading"
                icon={ICONS.privacy}
                title="Permissions"
                desc="These are your saved preferences. Changes apply immediately."
              />
              {renderToggles(PRIVACY_ITEMS, 'settings-permissions-heading')}
            </section>
          )}

          {tab === 'notifications' && (
            <section className="acct-section" aria-labelledby="settings-notifications-heading">
              <SectionHead
                id="settings-notifications-heading"
                icon={ICONS.notifications}
                title="Alerts"
                desc="Changes apply immediately."
              />
              {renderToggles(NOTIFICATION_ITEMS, 'settings-notifications-heading')}
            </section>
          )}

          {tab === 'report' && (
            <section className="acct-section" aria-labelledby="settings-report-heading">
              <SectionHead id="settings-report-heading" icon={ICONS.report} title="Submit a report" desc="Reports are private. We review every one." />
              <form onSubmit={handleSubmitReport}>
                <Row label="User" desc="Optional. Search by username." htmlFor="report-user-search" top>
                  <span className="acct-field">
                    {reportSelectedUser ? (
                      <span className="st-selected">
                        <Avatar url={reportSelectedUser.avatar_url} name={reportSelectedUser.username ?? reportSelectedUser.id} size="sm" />
                        <span className="acct-person-name">
                          @{reportSelectedUser.username ?? reportSelectedUser.id.slice(0, 8)}
                        </span>
                        <button
                          type="button"
                          className="rd-btn rd-btn--sm rd-btn--ghost"
                          onClick={() => {
                            setReportSelectedUser(null);
                            setReportUserQuery('');
                            setReportUserResults([]);
                          }}
                        >
                          Clear
                        </button>
                      </span>
                    ) : (
                      <span className="pf-photo">
                        <span className="acct-affix">
                          <span className="acct-affix-glyph" aria-hidden>
                            @
                          </span>
                          <input
                            id="report-user-search"
                            type="text"
                            className="rd-input"
                            placeholder="username"
                            value={reportUserQuery}
                            onChange={(e) => setReportUserQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleReportUserSearch())}
                          />
                        </span>
                        <button
                          type="button"
                          className="rd-btn"
                          onClick={handleReportUserSearch}
                          disabled={reportUserSearching || reportUserQuery.trim().length < 2}
                        >
                          {reportUserSearching ? <span className="rd-spinner acct-btn-spinner" aria-label="Searching" /> : 'Search'}
                        </button>
                      </span>
                    )}
                    {reportUserResults.length > 0 && !reportSelectedUser && (
                      <ul className="st-results" aria-label="Search results">
                        {reportUserResults.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setReportSelectedUser(u);
                                setReportUserResults([]);
                                setReportUserQuery('');
                              }}
                            >
                              <Avatar url={u.avatar_url} name={u.username ?? u.id} size="sm" />
                              @{u.username ?? u.id.slice(0, 8)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                </Row>
                <Row label="Type" htmlFor="report-type">
                  <select
                    id="report-type"
                    className="rd-select"
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as ReportType)}
                  >
                    {REPORT_TYPES.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Details" desc="Optional. What happened, and when." htmlFor="report-desc" top>
                  <textarea
                    id="report-desc"
                    className="rd-textarea"
                    placeholder="Provide details…"
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    rows={3}
                  />
                </Row>
                <div className="acct-footer">
                  {reportMessage && (
                    <span
                      className={`acct-msg ${reportMessage.type === 'success' ? 'acct-msg--success' : 'acct-msg--error'}`}
                      role="alert"
                    >
                      {reportMessage.text}
                    </span>
                  )}
                  <button type="submit" className="rd-btn rd-btn--primary" disabled={reportSubmitting}>
                    {reportSubmitting ? 'Submitting…' : 'Submit report'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {tab === 'contact' && (
            <section className="acct-section" aria-labelledby="settings-contact-heading">
              <SectionHead id="settings-contact-heading" icon={ICONS.contact} title="Message the team" />
              <form onSubmit={handleSubmitContact}>
                <Row label="Name" htmlFor="contact-name">
                  <input
                    id="contact-name"
                    type="text"
                    className="rd-input"
                    placeholder="Your name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    autoComplete="name"
                  />
                </Row>
                <Row label="Email" desc="Where we should reply." htmlFor="contact-email">
                  <input
                    id="contact-email"
                    type="email"
                    className="rd-input"
                    placeholder="you@example.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    autoComplete="email"
                  />
                </Row>
                <Row label="Message" htmlFor="contact-message" top>
                  <textarea
                    id="contact-message"
                    className="rd-textarea"
                    placeholder="Your message…"
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    rows={4}
                  />
                </Row>
                <div className="acct-footer">
                  {contactMessageResult && (
                    <span
                      className={`acct-msg ${contactMessageResult.type === 'success' ? 'acct-msg--success' : 'acct-msg--error'}`}
                      role="alert"
                    >
                      {contactMessageResult.text}
                    </span>
                  )}
                  <button type="submit" className="rd-btn rd-btn--primary" disabled={contactSubmitting}>
                    {contactSubmitting ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {tab === 'legal' && (
            <section className="acct-section" aria-labelledby="settings-legal-heading">
              <SectionHead id="settings-legal-heading" icon={ICONS.legal} title="Terms, Privacy & User Policy" desc="Select a document to read it." />
              {LEGAL_DOCS.map((doc) => {
                const open = legalAccordionOpen === doc.id;
                return (
                  <div key={doc.id} className={`st-accordion-item${open ? ' st-accordion-item--open' : ''}`}>
                    <button
                      type="button"
                      className="st-accordion-trigger"
                      onClick={() => setLegalAccordionOpen(open ? null : doc.id)}
                      aria-expanded={open}
                      aria-controls={`legal-${doc.id}-panel`}
                      id={`legal-${doc.id}-trigger`}
                    >
                      <span>{doc.title}</span>
                      {open ? ICONS.minus : ICONS.plus}
                    </button>
                    <div
                      id={`legal-${doc.id}-panel`}
                      role="region"
                      aria-labelledby={`legal-${doc.id}-trigger`}
                      className="st-accordion-panel"
                    >
                      <div className="st-legal-body">
                        <LegalContentRenderer sections={doc.sections} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmOpen && (
        <div
          className="rd-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={(e) => e.target === e.currentTarget && setDeleteConfirmOpen(false)}
        >
          <div className="rd-modal st-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-modal-title" className="st-modal-title">
              Delete account permanently?
            </h3>
            <p className="st-modal-text">
              This removes your account and all of its data. Type <code>delete</code> to confirm.
            </p>
            <input
              type="text"
              className="rd-input"
              placeholder="delete"
              aria-label="Type delete to confirm"
              value={deleteConfirmText}
              onChange={(e) => {
                setDeleteConfirmText(e.target.value);
                setDeleteError(null);
              }}
              autoFocus
            />
            {deleteError && (
              <p className="acct-msg acct-msg--error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="st-modal-actions">
              <button
                type="button"
                className="rd-btn"
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeleteConfirmText('');
                }}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rd-btn rd-btn--danger"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText.toLowerCase() !== 'delete' || deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
