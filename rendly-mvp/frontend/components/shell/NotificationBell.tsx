'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
      {error ? <span className="rd-small shell-error">{error}</span> : null}
    </div>
  );
}

/** Matches the `max-width: 767px` breakpoint in shell.css where the panel spans the viewport. */
const MOBILE_MAX_WIDTH = 767;
const PANEL_MAX_WIDTH = 380;
const PANEL_GUTTER = 24;
const EDGE_MARGIN = 8;

interface PanelPos {
  top: number;
  right: number;
  mobile: boolean;
}

/** Anchor the panel under the bell, clamped so its left edge stays >= EDGE_MARGIN. */
function computePanelPos(button: HTMLElement): PanelPos {
  const rect = button.getBoundingClientRect();
  const vw = window.innerWidth;
  const top = rect.bottom + EDGE_MARGIN;
  if (vw <= MOBILE_MAX_WIDTH) return { top, right: EDGE_MARGIN, mobile: true };
  const panelWidth = Math.min(PANEL_MAX_WIDTH, vw - PANEL_GUTTER);
  const maxRight = vw - panelWidth - EDGE_MARGIN;
  const right = Math.min(Math.max(EDGE_MARGIN, vw - rect.right), Math.max(EDGE_MARGIN, maxRight));
  return { top, right, mobile: false };
}

export function NotificationBell() {
  const router = useRouter();
  const { items, unreadCount, loading, error, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<PanelPos>({ top: 0, right: 0, mobile: false });

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      return;
    }
    const isInside = (target: Node) =>
      Boolean(wrapRef.current?.contains(target) || panelRef.current?.contains(target));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) setOpen(false);
    };
    const reposition = () => {
      if (buttonRef.current) setPanelPos(computePanelPos(buttonRef.current));
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const togglePanel = () => {
    if (!open && buttonRef.current) setPanelPos(computePanelPos(buttonRef.current));
    setOpen((o) => !o);
  };

  return (
    <div ref={wrapRef} style={{ position: 'static' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`rd-icon-btn ${open ? 'rd-icon-btn--on' : ''}`}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={togglePanel}
      >
        <Icon name="bell" size={17} />
        {unreadCount > 0 ? <span className="rd-count">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="rd-notif-panel shell-notif"
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'fixed',
            top: panelPos.top,
            ...(panelPos.mobile ? { left: 8, right: 8 } : { right: panelPos.right }),
          }}
        >
          <div className="rd-notif-head">
            <span className="shell-notif-title">
              Notifications
              {unreadCount > 0 ? <span className="shell-notif-count">{unreadCount}</span> : null}
            </span>
            <div className="shell-notif-actions">
              <button
                type="button"
                className="rd-btn rd-btn--ghost rd-btn--sm"
                disabled={unreadCount === 0}
                onClick={() => void markAllRead()}
                title="Mark all as read"
              >
                <Icon name="check" size={14} /> <span className="shell-notif-action-label">Mark all read</span>
              </button>
              {confirmClear ? (
                <button type="button" className="rd-btn rd-btn--danger rd-btn--sm" onClick={() => { setConfirmClear(false); void clearAll(); }}>
                  Confirm clear
                </button>
              ) : (
                <button
                  type="button"
                  className="rd-btn rd-btn--ghost rd-btn--sm"
                  disabled={items.length === 0}
                  onClick={() => setConfirmClear(true)}
                  title="Clear all"
                >
                  <Icon name="trash" size={14} /> <span className="shell-notif-action-label">Clear</span>
                </button>
              )}
            </div>
          </div>
          <div className="rd-notif-list rd-scroll">
            {loading && items.length === 0 ? (
              <>
                <div className="rd-skeleton shell-notif-skel" />
                <div className="rd-skeleton shell-notif-skel" />
                <div className="rd-skeleton shell-notif-skel" />
              </>
            ) : items.length === 0 ? (
              <div className="shell-empty">
                <span className="shell-empty-icon" aria-hidden>
                  <Icon name="inbox" size={18} />
                </span>
                <p>You&apos;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => {
                const href = notificationHref(n);
                return (
                  <div
                    key={n.id}
                    className={`rd-notif-item shell-notif-item ${n.read ? '' : 'rd-notif-item--unread'}`}
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
                    <span className="shell-notif-icon" aria-hidden>
                      <Icon name={notificationIcon(n.type)} size={15} />
                    </span>
                    <div className="shell-notif-body">
                      <div className="shell-notif-line">
                        <span className="shell-notif-name">{n.title}</span>
                        <time className="shell-notif-time" dateTime={n.created_at}>
                          {timeAgo(n.created_at)}
                        </time>
                      </div>
                      {n.body ? <div className="shell-notif-text">{n.body}</div> : null}
                      {n.type === 'group_invite' ? <GroupInviteActions n={n} onDone={() => setOpen(false)} /> : null}
                    </div>
                    {!n.read ? <span className="rd-notif-dot shell-notif-dot" aria-label="Unread" /> : null}
                  </div>
                );
              })
            )}
            {error ? <p className="rd-small shell-error">{error}</p> : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
