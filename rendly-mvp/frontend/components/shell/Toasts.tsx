'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, type Toast } from '@/context/NotificationsContext';
import { Icon } from './Icon';

/** Drag further than this (px) sideways to dismiss. */
const SWIPE_DISMISS_PX = 90;

function ToastCard({ toast }: { toast: Toast }) {
  const router = useRouter();
  const { dismissToast, markRead } = useNotifications();
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const start = useRef<{ x: number; id: number } | null>(null);
  const moved = useRef(false);

  const leave = (direction: number) => {
    setLeaving(true);
    setDx(direction * 480);
    setTimeout(() => dismissToast(toast.id), 220);
  };

  const open = () => {
    if (moved.current) return;
    if (toast.notificationId) void markRead(toast.notificationId);
    dismissToast(toast.id);
    if (toast.href) router.push(toast.href);
  };

  return (
    <div
      className="rd-toast"
      role="status"
      style={{
        transform: `translateX(${dx}px)`,
        opacity: leaving ? 0 : Math.max(0.2, 1 - Math.abs(dx) / 260),
        transition: start.current ? 'none' : undefined,
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, id: e.pointerId };
        moved.current = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current || start.current.id !== e.pointerId) return;
        const d = e.clientX - start.current.x;
        if (Math.abs(d) > 6) moved.current = true;
        setDx(d);
      }}
      onPointerUp={(e) => {
        if (!start.current || start.current.id !== e.pointerId) return;
        const d = e.clientX - start.current.x;
        start.current = null;
        if (Math.abs(d) > SWIPE_DISMISS_PX) leave(Math.sign(d));
        else setDx(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
      onClick={open}
    >
      <span className="rd-toast-icon" aria-hidden>
        <Icon name={toast.icon} size={18} />
      </span>
      <div className="rd-toast-body">
        <div className="rd-toast-title">{toast.title}</div>
        {toast.body ? <div className="rd-small rd-muted">{toast.body}</div> : null}
        {toast.actionLabel && toast.href ? (
          <div className="rd-toast-actions">
            <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={(e) => { e.stopPropagation(); moved.current = false; open(); }}>
              {toast.actionLabel}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="rd-icon-btn"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          leave(1);
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useNotifications();
  return (
    <div className="rd-toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
