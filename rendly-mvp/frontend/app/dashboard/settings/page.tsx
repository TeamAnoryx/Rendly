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

/* Section icons */
const IconBlock = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M4.93 4.93 19.07 19.07" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>
);
const IconTrash = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);
const IconReport = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" x2="12" y1="9" y2="13" />
    <line x1="12" x2="12.01" y1="17" y2="17" />
  </svg>
);
const IconDoc = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" x2="8" y1="13" y2="13" />
    <line x1="16" x2="8" y1="17" y2="17" />
    <line x1="10" x2="8" y1="9" y2="9" />
  </svg>
);
const IconMail = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
const IconSliders = () => (
  <svg className="dash-settings-section-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" x2="21" y1="21" y2="21" />
    <line x1="4" x2="21" y1="14" y2="14" />
    <line x1="4" x2="21" y1="7" y2="7" />
    <line x1="4" x2="4" y1="3" y2="21" />
    <line x1="14" x2="14" y1="3" y2="21" />
    <line x1="21" x2="21" y1="3" y2="21" />
  </svg>
);

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
];

const PERMISSION_ITEMS: { key: keyof UserSettings; label: string; description: string }[] = [
  { key: 'camera_allowed', label: 'Camera', description: 'Allow access to your camera' },
  { key: 'microphone_allowed', label: 'Microphone', description: 'Allow access to your microphone' },
  { key: 'notifications_allowed', label: 'Notifications', description: 'Receive push and in-app notifications' },
  { key: 'location_allowed', label: 'Location', description: 'Share your location when needed' },
  { key: 'popups_redirects_allowed', label: 'Pop-ups & redirects', description: 'Allow pop-ups and redirects' },
  { key: 'sound_allowed', label: 'Sound', description: 'Play sounds for messages and calls' },
  { key: 'auto_verify', label: 'Auto-verify', description: 'Automatically verify your identity' },
  { key: 'on_device_site_data', label: 'On-device site data', description: 'Store data on this device' },
];

const SETTINGS_TABS = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'report', label: 'Report' },
  { id: 'contact', label: 'Contact us' },
  { id: 'legal', label: 'Terms & policy' },
  { id: 'account', label: 'Account' },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('privacy');
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

  return (
    <div className="dash-settings-root">
      <div className="dash-settings-main">
        <h1 className="dash-settings-title">Settings</h1>
        <p className="dash-settings-subtitle">Manage your account, privacy, and preferences.</p>
        <nav className="set-tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`set-tab ${tab === t.id ? 'set-tab--on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="dash-settings-grid" data-active={tab}>
          {/* Blocked users */}
          <section className="dash-settings-card" aria-labelledby="settings-blocked-heading" data-tab="privacy">
            <h2 id="settings-blocked-heading" className="dash-settings-card-title">
              <IconBlock />
              Blocked users
            </h2>
            <p className="dash-settings-card-desc">Unblock users you previously blocked. To block someone, go to your <Link href="/dashboard/profile" className="dash-settings-link">Profile</Link> and use Connections.</p>
            {blockedLoading ? (
              <p className="dash-settings-stub">Loading…</p>
            ) : blockedUsers.length === 0 ? (
              <p className="dash-settings-empty">No blocked users.</p>
            ) : (
              <ul className="dash-settings-list" aria-label="Blocked users">
                {blockedUsers.map((u) => (
                  <li key={u.id} className="dash-settings-list-item">
                    <div className="dash-settings-list-item-info">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="dash-settings-avatar" />
                      ) : (
                        <div className="dash-settings-avatar dash-settings-avatar-placeholder" />
                      )}
                      <span className="dash-settings-username">@{u.username ?? u.id.slice(0, 8)}</span>
                    </div>
                    <button
                      type="button"
                      className="dash-settings-btn dash-settings-btn-secondary"
                      onClick={() => handleUnblock(u.id)}
                      disabled={unblockingId === u.id}
                    >
                      {unblockingId === u.id ? '…' : 'Unblock'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Delete account */}
          <section className="dash-settings-card dash-settings-card-danger" aria-labelledby="settings-delete-heading" data-tab="account">
            <h2 id="settings-delete-heading" className="dash-settings-card-title">
              <IconTrash />
              Delete account
            </h2>
            <p className="dash-settings-card-desc">Permanently delete your account and all associated data. This cannot be undone.</p>
            <button
              type="button"
              className="dash-settings-btn dash-settings-btn-danger"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete my account
            </button>
          </section>

          {/* Report */}
          <section className="dash-settings-card" aria-labelledby="settings-report-heading" data-tab="report">
            <h2 id="settings-report-heading" className="dash-settings-card-title">
              <IconReport />
              Report
            </h2>
            <p className="dash-settings-card-desc">Report harassment, fraud, spam, or other concerning activity.</p>
            <form onSubmit={handleSubmitReport} className="dash-settings-form">
              <label className="dash-settings-label" htmlFor="report-user-search">User to report (optional)</label>
              <div className="dash-settings-search-wrap">
                <input
                  id="report-user-search"
                  type="text"
                  className="dash-settings-input"
                  placeholder="@username"
                  value={reportUserQuery}
                  onChange={(e) => setReportUserQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleReportUserSearch())}
                  disabled={!!reportSelectedUser}
                />
                <button
                  type="button"
                  className="dash-settings-btn dash-settings-btn-secondary"
                  onClick={handleReportUserSearch}
                  disabled={reportUserSearching || reportUserQuery.trim().length < 2 || !!reportSelectedUser}
                >
                  {reportUserSearching ? '…' : 'Search'}
                </button>
              </div>
              {reportSelectedUser && (
                <div className="dash-settings-report-selected">
                  <div className="dash-settings-report-selected-info">
                    {reportSelectedUser.avatar_url ? (
                      <img src={reportSelectedUser.avatar_url} alt="" className="dash-settings-avatar" />
                    ) : (
                      <div className="dash-settings-avatar dash-settings-avatar-placeholder" />
                    )}
                    <span className="dash-settings-username">@{reportSelectedUser.username ?? reportSelectedUser.id.slice(0, 8)}</span>
                  </div>
                  <button
                    type="button"
                    className="dash-settings-btn dash-settings-btn-secondary dash-settings-report-clear"
                    onClick={() => { setReportSelectedUser(null); setReportUserQuery(''); setReportUserResults([]); }}
                  >
                    Clear
                  </button>
                </div>
              )}
              {reportUserResults.length > 0 && !reportSelectedUser && (
                <ul className="dash-settings-report-results" aria-label="Search results">
                  {reportUserResults.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className="dash-settings-report-result-btn"
                        onClick={() => { setReportSelectedUser(u); setReportUserResults([]); setReportUserQuery(''); }}
                      >
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="dash-settings-avatar" />
                        ) : (
                          <div className="dash-settings-avatar dash-settings-avatar-placeholder" />
                        )}
                        <span className="dash-settings-username">@{u.username ?? u.id.slice(0, 8)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="dash-settings-label" htmlFor="report-type">Type</label>
              <select
                id="report-type"
                className="dash-settings-select"
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
              >
                {REPORT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label className="dash-settings-label" htmlFor="report-desc">Description (optional)</label>
              <textarea
                id="report-desc"
                className="dash-settings-textarea"
                placeholder="Provide details..."
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                rows={3}
              />
              {reportMessage && (
                <p className={reportMessage.type === 'success' ? 'dash-settings-success' : 'dash-settings-error'} role="alert">
                  {reportMessage.text}
                </p>
              )}
              <button type="submit" className="dash-settings-btn dash-settings-btn-primary" disabled={reportSubmitting}>
                {reportSubmitting ? 'Submitting…' : 'Submit report'}
              </button>
            </form>
          </section>

          {/* Contact us — right of Report */}
          <section className="dash-settings-card" aria-labelledby="settings-contact-heading" data-tab="contact">
            <h2 id="settings-contact-heading" className="dash-settings-card-title">
              <IconMail />
              Contact us
            </h2>
            <p className="dash-settings-card-desc">Send us a message and we will respond as soon as we can.</p>
            <form onSubmit={handleSubmitContact} className="dash-settings-form">
              <label className="dash-settings-label" htmlFor="contact-name">Name</label>
              <input
                id="contact-name"
                type="text"
                className="dash-settings-input"
                placeholder="Your name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
              <label className="dash-settings-label" htmlFor="contact-email">Email</label>
              <input
                id="contact-email"
                type="email"
                className="dash-settings-input"
                placeholder="you@example.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <label className="dash-settings-label" htmlFor="contact-message">Message</label>
              <textarea
                id="contact-message"
                className="dash-settings-textarea"
                placeholder="Your message..."
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                rows={4}
              />
              {contactMessageResult && (
                <p className={contactMessageResult.type === 'success' ? 'dash-settings-success' : 'dash-settings-error'} role="alert">
                  {contactMessageResult.text}
                </p>
              )}
              <button type="submit" className="dash-settings-btn dash-settings-btn-primary" disabled={contactSubmitting}>
                {contactSubmitting ? 'Sending…' : 'Send message'}
              </button>
            </form>
          </section>

          {/* Terms, Privacy & User Policy — full width, accordion */}
          <section className="dash-settings-card dash-settings-card-wide" aria-labelledby="settings-legal-heading" data-tab="legal">
            <h2 id="settings-legal-heading" className="dash-settings-card-title">
              <IconDoc />
              Terms, Privacy & User Policy
            </h2>
            <p className="dash-settings-card-desc">Click a topic to expand. Same content as at signup.</p>
            <div className="dash-settings-accordion">
              <div className={`dash-settings-accordion-item ${legalAccordionOpen === 'terms' ? 'dash-settings-accordion-item-open' : ''}`}>
                <button
                  type="button"
                  className="dash-settings-accordion-trigger"
                  onClick={() => setLegalAccordionOpen(legalAccordionOpen === 'terms' ? null : 'terms')}
                  aria-expanded={legalAccordionOpen === 'terms'}
                  aria-controls="legal-terms-panel"
                  id="legal-terms-trigger"
                >
                  <span className="dash-settings-accordion-title">Terms of Service</span>
                  <span className="dash-settings-accordion-icon" aria-hidden>
                    {legalAccordionOpen === 'terms' ? '−' : '+'}
                  </span>
                </button>
                <div
                  id="legal-terms-panel"
                  role="region"
                  aria-labelledby="legal-terms-trigger"
                  className="dash-settings-accordion-panel"
                >
                  <div className="dash-settings-legal-body">
                    <LegalContentRenderer sections={TERMS_SECTIONS} />
                  </div>
                </div>
              </div>
              <div className={`dash-settings-accordion-item ${legalAccordionOpen === 'privacy' ? 'dash-settings-accordion-item-open' : ''}`}>
                <button
                  type="button"
                  className="dash-settings-accordion-trigger"
                  onClick={() => setLegalAccordionOpen(legalAccordionOpen === 'privacy' ? null : 'privacy')}
                  aria-expanded={legalAccordionOpen === 'privacy'}
                  aria-controls="legal-privacy-panel"
                  id="legal-privacy-trigger"
                >
                  <span className="dash-settings-accordion-title">Privacy Policy</span>
                  <span className="dash-settings-accordion-icon" aria-hidden>
                    {legalAccordionOpen === 'privacy' ? '−' : '+'}
                  </span>
                </button>
                <div
                  id="legal-privacy-panel"
                  role="region"
                  aria-labelledby="legal-privacy-trigger"
                  className="dash-settings-accordion-panel"
                >
                  <div className="dash-settings-legal-body">
                    <LegalContentRenderer sections={PRIVACY_SECTIONS} />
                  </div>
                </div>
              </div>
              <div className={`dash-settings-accordion-item ${legalAccordionOpen === 'user' ? 'dash-settings-accordion-item-open' : ''}`}>
                <button
                  type="button"
                  className="dash-settings-accordion-trigger"
                  onClick={() => setLegalAccordionOpen(legalAccordionOpen === 'user' ? null : 'user')}
                  aria-expanded={legalAccordionOpen === 'user'}
                  aria-controls="legal-user-panel"
                  id="legal-user-trigger"
                >
                  <span className="dash-settings-accordion-title">User Policy</span>
                  <span className="dash-settings-accordion-icon" aria-hidden>
                    {legalAccordionOpen === 'user' ? '−' : '+'}
                  </span>
                </button>
                <div
                  id="legal-user-panel"
                  role="region"
                  aria-labelledby="legal-user-trigger"
                  className="dash-settings-accordion-panel"
                >
                  <div className="dash-settings-legal-body">
                    <LegalContentRenderer sections={USER_POLICY_SECTIONS} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Permissions */}
          <section className="dash-settings-card dash-settings-card-wide" aria-labelledby="settings-permissions-heading" data-tab="privacy">
            <h2 id="settings-permissions-heading" className="dash-settings-card-title">
              <IconSliders />
              Permissions
            </h2>
            <p className="dash-settings-card-desc">Control what the app can access. These are your saved preferences.</p>
            {settingsLoading ? (
              <p className="dash-settings-stub">Loading…</p>
            ) : settings ? (
              <div className="dash-settings-toggles">
                {PERMISSION_ITEMS.map(({ key, label, description }) => (
                  <div key={key} className="dash-settings-toggle-row">
                    <div className="dash-settings-toggle-label-wrap">
                      <span className="dash-settings-toggle-label">{label}</span>
                      <span className="dash-settings-toggle-desc">{description}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings[key]}
                      className={`dash-settings-toggle ${settings[key] ? 'dash-settings-toggle-on' : ''}`}
                      onClick={() => handleToggleSetting(key, !settings[key])}
                    >
                      <span className="dash-settings-toggle-thumb" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dash-settings-error">Could not load settings.</p>
            )}
          </section>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmOpen && (
        <div
          className="dash-settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={(e) => e.target === e.currentTarget && setDeleteConfirmOpen(false)}
        >
          <div className="dash-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-modal-title" className="dash-settings-modal-title">Delete account permanently?</h3>
            <p className="dash-settings-modal-text">This will remove your account and all data. Type <strong>delete</strong> below to confirm.</p>
            <input
              type="text"
              className="dash-settings-input"
              placeholder="Type delete"
              value={deleteConfirmText}
              onChange={(e) => { setDeleteConfirmText(e.target.value); setDeleteError(null); }}
              autoFocus
            />
            {deleteError && <p className="dash-settings-error" role="alert">{deleteError}</p>}
            <div className="dash-settings-modal-actions">
              <button
                type="button"
                className="dash-settings-btn dash-settings-btn-secondary"
                onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); }}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dash-settings-btn dash-settings-btn-danger"
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
