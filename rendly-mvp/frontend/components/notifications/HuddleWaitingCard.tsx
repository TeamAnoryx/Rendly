'use client';

import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { useNotifications } from '@/context/NotificationsContext';
import {
  addReminder,
  ensureNotificationPermission,
  hasReminder,
  removeReminder,
  type HuddleRef,
} from '@/lib/huddleReminders';
import { subscribeToPush } from '@/lib/webPush';
import './huddle-waiting-card.css';

const TICK_MS = 1000;

/** "Starts in 4m 10s", "Starting now", or the local start time when far away. */
export function startLabel(scheduledAt: string | null, now: number): string {
  if (!scheduledAt) return 'Starts when the host lets you in';
  const at = Date.parse(scheduledAt);
  if (!Number.isFinite(at)) return 'Starts when the host lets you in';
  const left = at - now;
  if (left <= 0) return 'Starting now';
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  if (mins >= 60) {
    return `Starts ${new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  }
  return mins > 0 ? `Starts in ${mins}m ${secs}s` : `Starts in ${secs}s`;
}

export type HuddleWaitingCardProps = {
  huddle: HuddleRef;
  onJoin: () => void;
};

/** Waiting-room card in the notifications panel: huddle, time to join, Join and Remind me. */
export default function HuddleWaitingCard({ huddle, onJoin }: HuddleWaitingCardProps) {
  const { pushToast } = useNotifications();
  const [now, setNow] = useState(() => Date.now());
  const [reminded, setReminded] = useState(false);

  useEffect(() => setReminded(hasReminder(huddle.id)), [huddle.id]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const toggleReminder = async () => {
    if (reminded) {
      removeReminder(huddle.id);
      setReminded(false);
      return;
    }
    const allowed = await ensureNotificationPermission();
    if (allowed) void subscribeToPush();
    addReminder(huddle);
    setReminded(true);
    pushToast(
      allowed
        ? { icon: 'bell', title: 'Reminder set', body: 'We will notify you when the huddle goes live.' }
        : { icon: 'bell', title: 'Reminder set', body: 'Browser notifications are blocked, so we will remind you here instead.' },
    );
  };

  return (
    <section className="hwc" aria-label="Huddle waiting room">
      <div className="hwc-head">
        <span className="hwc-icon" aria-hidden="true">
          <Icon name="people" size={16} />
        </span>
        <div className="hwc-text">
          <p className="hwc-eyebrow">In the waiting room</p>
          <p className="hwc-title">{huddle.title}</p>
          <p className="hwc-time" aria-live="polite">
            {startLabel(huddle.scheduled_at, now)}
          </p>
        </div>
      </div>
      <div className="hwc-actions">
        <button type="button" className="rd-btn rd-btn--primary rd-btn--sm hwc-btn" onClick={onJoin}>
          <Icon name="door" size={15} /> Join
        </button>
        <button
          type="button"
          className={`rd-btn rd-btn--ghost rd-btn--sm hwc-btn ${reminded ? 'hwc-btn--on' : ''}`}
          aria-pressed={reminded}
          onClick={() => void toggleReminder()}
        >
          <Icon name="bell" size={15} /> {reminded ? 'Reminder on' : 'Remind me'}
        </button>
      </div>
    </section>
  );
}
