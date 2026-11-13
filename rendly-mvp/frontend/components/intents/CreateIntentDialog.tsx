'use client';

import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import { Icon } from '@/components/shell/Icon';
import { useNotifications } from '@/context/NotificationsContext';
import { createIntent, INTENT_PRIVATE_DAYS, INTENT_ROYALTY, type IntentVisibility, type MyIntent } from '@/services/intentsApi';

export const INTENT_NAME_MIN = 2;
export const INTENT_NAME_MAX = 40;

/** Client-side mirror of the server's name rule; returns a message or null when valid. */
export function validateIntentName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < INTENT_NAME_MIN) return `Use at least ${INTENT_NAME_MIN} characters.`;
  if (name.length > INTENT_NAME_MAX) return `Keep it under ${INTENT_NAME_MAX} characters.`;
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Add at least one letter or number.';
  return null;
}

export type CreateIntentDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called with the new intent after a successful create (parent refreshes its lists). */
  onCreated?: (intent: MyIntent) => void;
};

export default function CreateIntentDialog({ open, onClose, onCreated }: CreateIntentDialogProps) {
  const { pushToast } = useNotifications();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<IntentVisibility>('public');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setVisibility('public');
    setTouched(false);
    setSaving(false);
    setError(null);
  }, [open]);

  const nameError = validateIntentName(name);
  const isPublic = visibility === 'public';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameError || saving) return;
    setSaving(true);
    setError(null);
    try {
      const intent = await createIntent({ name: name.trim(), visibility });
      pushToast({ icon: 'sparkles', title: 'Intent created', body: `“${intent.name}” is ${isPublic ? 'live in search' : 'private to you'}.` });
      onCreated?.(intent);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that intent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} title="Create an intent">
      <form onSubmit={submit} className="cid" noValidate>
        <label className="cid-label" htmlFor="cid-name">
          Name
        </label>
        <input
          id="cid-name"
          className="rd-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Chess, Pitch practice, Co-founder hunt"
          maxLength={INTENT_NAME_MAX}
          autoFocus
          autoComplete="off"
          aria-invalid={touched && !!nameError}
          aria-describedby="cid-name-hint"
        />
        <div id="cid-name-hint" className={`cid-hint${touched && nameError ? ' cid-hint--err' : ''}`}>
          {touched && nameError ? nameError : `${name.trim().length}/${INTENT_NAME_MAX}`}
        </div>

        <div className="cid-vis">
          <div className="cid-vis-text">
            <span className="cid-vis-title">
              <Icon name={isPublic ? 'globe' : 'lock'} size={14} />
              {isPublic ? 'Public' : 'Private'}
            </span>
            <p className="cid-vis-desc">
              {isPublic
                ? `Free. Listed in search for everyone, and you earn ${INTENT_ROYALTY} tokens whenever someone buys it.`
                : `Free. Only you can see it, and it expires in ${INTENT_PRIVATE_DAYS} days.`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-label={isPublic ? 'Public intent. Switch to private' : 'Private intent. Switch to public'}
            className="acct-switch"
            onClick={() => setVisibility(isPublic ? 'private' : 'public')}
            disabled={saving}
          />
        </div>

        {error ? (
          <p className="acct-msg acct-msg--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="cid-actions">
          <button type="button" className="rd-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="rd-btn rd-btn--primary" disabled={saving || (touched && !!nameError)}>
            {saving ? (
              <>
                <span className="rd-spinner acct-btn-spinner" aria-hidden />
                Creating…
              </>
            ) : (
              'Create intent'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
