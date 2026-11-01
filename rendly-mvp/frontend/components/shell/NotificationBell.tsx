'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/context/NotificationsContext';
import { notificationHref, notificationIcon, type AppNotification } from '@/services/notificationsApi';
import { groupsApi } from '@/services/groups';
import { Icon } from './Icon';

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function GroupInviteActions({ n, onDone }: { n: AppNotification; onDone: () => void }) {
  const router = useRouter();
  const { markRead } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inviteId = typeof n.payload.invite_id === 'string' ? n.payload.invite_id : null;
  if (!inviteId || n.read) return null;

  const act = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const ok = accept ? await groupsApi.acceptInvite(inviteId) : await groupsApi.rejectInvite(inviteId);
      if (!ok) throw new Error('The invite is no longer valid');
      await markRead(n.id);
      if (accept) {
        onDone();
        router.push('/dashboard/chat?tab=Group');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rd-toast-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={busy} onClick={() => act(true)}>
        {busy ? <span className="rd-spinner" /> : 'Accept'}
      </button>
      <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={busy} onClick={() => act(false)}>
        Decline
      </button>
      {error ? <span className="rd-small" style={{ color: 'var(--rd-danger)' }}>{error}</span> : null}
    </div>
  );
}

export function NotificationBell() {
  const router = useRouter();
  const { items, unreadCount, loading, error, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'static' }}>
      <button
        type="button"
        className="rd-icon-btn"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={19} />
        {unreadCount > 0 ? <span className="rd-count">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </button>
      {open && (
        <div className="rd-notif-panel" role="dialog" aria-label="Notifications">
          <div className="rd-notif-head">
            <strong>Notifications</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
                <Icon name="check" size={14} /> Mark all read
              </button>
              {confirmClear ? (
                <button type="button" className="rd-btn rd-btn--danger rd-btn--sm" onClick={() => { setConfirmClear(false); void clearAll(); }}>
                  Confirm clear
                </button>
              ) : (
                <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" disabled={items.length === 0} onClick={() => setConfirmClear(true)}>
                  <Icon name="trash" size={14} /> Clear
                </button>
              )}
            </div>
          </div>
          <div className="rd-notif-list rd-scroll">
            {loading && items.length === 0 ? (
              <>
                <div className="rd-skeleton" style={{ height: 56, margin: 6 }} />
                <div className="rd-skeleton" style={{ height: 56, margin: 6 }} />
              </>
            ) : items.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center' }} className="rd-muted">
                <Icon name="bell" size={28} />
                <p style={{ marginTop: 8 }}>You&apos;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => {
                const href = notificationHref(n);
                return (
                  <div
                    key={n.id}
                    className={`rd-notif-item ${n.read ? '' : 'rd-notif-item--unread'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!n.read) void markRead(n.id);
                      if (href) {
                        setOpen(false);
                        router.push(href);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.currentTarget as HTMLElement).click();
                    }}
                  >
                    <span className="rd-toast-icon" aria-hidden>
                      <Icon name={notificationIcon(n.type)} size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{n.title}</div>
                      {n.body ? <div className="rd-small rd-muted">{n.body}</div> : null}
                      <div className="rd-small rd-muted" style={{ marginTop: 2 }}>{timeAgo(n.created_at)}</div>
                      {n.type === 'group_invite' ? <GroupInviteActions n={n} onDone={() => setOpen(false)} /> : null}
                    </div>
                    {!n.read ? <span className="rd-notif-dot" aria-label="Unread" /> : null}
                  </div>
                );
              })
            )}
            {error ? <p className="rd-small" style={{ color: 'var(--rd-danger)', padding: 12 }}>{error}</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}
