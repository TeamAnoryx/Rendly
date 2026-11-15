'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { ensureNotificationPermission } from '@/lib/huddleReminders';
import { pushSupported, subscribeToPush } from '@/lib/webPush';
import './notification-consent.css';

/** Fired (window event) by features that need notifications, e.g. joining a huddle waiting list. */
export const ASK_NOTIFICATIONS_EVENT = 'rendly:ask-notifications';

const CHOICE_KEY = 'rendly_notif_consent';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const FIRST_ASK_DELAY_MS = 4000;

type Choice = { value: 'denied' } | { value: 'snoozed'; until: number };

function readChoice(): Choice | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CHOICE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const c = parsed as { value?: unknown; until?: unknown };
    if (c.value === 'denied') return { value: 'denied' };
    if (c.value === 'snoozed' && typeof c.until === 'number') return { value: 'snoozed', until: c.until };
    return null;
  } catch {
    return null;
  }
}

function writeChoice(choice: Choice): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the prompt may show again next visit */
  }
}

/** Ask for the consent card (or subscribe directly if notifications are already allowed). */
export function requestNotificationConsent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ASK_NOTIFICATIONS_EVENT));
}

/**
 * Soft ask for browser notifications: a small card at the bottom right (tablet and up) or a
 * slim bar at the top (phones). Allow opens the browser's own prompt; Deny and close are remembered.
 */
export default function NotificationConsent() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const canAsk = useCallback(() => {
    if (!pushSupported() || Notification.permission !== 'default') return false;
    const choice = readChoice();
    if (choice?.value === 'denied') return false;
    return !(choice?.value === 'snoozed' && choice.until > Date.now());
  }, []);

  useEffect(() => {
    if (!pushSupported()) return undefined;
    // Already allowed: keep this browser's push subscription saved.
    if (Notification.permission === 'granted') void subscribeToPush();
    const first = window.setTimeout(() => canAsk() && setOpen(true), FIRST_ASK_DELAY_MS);
    // A feature asked explicitly (joining a waiting list): show it even if snoozed, unless denied.
    const onAsk = () => {
      if (Notification.permission === 'granted') {
        void subscribeToPush();
        return;
      }
      if (Notification.permission === 'default' && readChoice()?.value !== 'denied') setOpen(true);
    };
    window.addEventListener(ASK_NOTIFICATIONS_EVENT, onAsk);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(ASK_NOTIFICATIONS_EVENT, onAsk);
    };
  }, [canAsk]);

  const allow = async () => {
    setBusy(true);
    const granted = await ensureNotificationPermission();
    if (granted) await subscribeToPush();
    else writeChoice({ value: 'denied' });
    setBusy(false);
    setOpen(false);
  };
  const deny = () => {
    writeChoice({ value: 'denied' });
    setOpen(false);
  };
  const close = () => {
    writeChoice({ value: 'snoozed', until: Date.now() + SNOOZE_MS });
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="notif-consent"
          className="nc"
          role="dialog"
          aria-labelledby="nc-title"
          aria-describedby="nc-body"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <span className={`nc-icon${reduce ? '' : ' nc-icon--ring'}`} aria-hidden="true">
            <Icon name="bell" size={18} />
          </span>
          <div className="nc-text">
            <p id="nc-title" className="nc-title">Get notified when it&apos;s live</p>
            <p id="nc-body" className="nc-body">
              Allow notifications and we&apos;ll ping you when a huddle you&apos;re waiting for starts. No spam.
            </p>
          </div>
          <div className="nc-actions">
            <button type="button" className="nc-btn nc-btn--ghost" onClick={deny} disabled={busy}>
              Deny
            </button>
            <button type="button" className="nc-btn nc-btn--primary" onClick={() => void allow()} disabled={busy}>
              {busy ? <span className="rd-spinner" aria-hidden="true" /> : <Icon name="check" size={14} />}
              Allow
            </button>
          </div>
          <button type="button" className="nc-close" aria-label="Close" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
