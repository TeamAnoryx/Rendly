'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { createIntent, type IntentVisibility } from '@/services/intentsApi';
import { emitPointsChanged } from '@/services/pointsApi';
import './sheet-parts.css';

export type SheetCustomAddProps = {
  disabled: boolean;
  onCreated(name: string): void;
  /** Called when the form opens or closes, so the sheet footer can re-flow around it. */
  onOpenChange?(open: boolean): void;
};

/** Mirrors components/intents/CreateIntentDialog (the Profile custom-intent rules). */
const NAME_MIN = 2;
const NAME_MAX = 40;
const EASE = [0.2, 0.8, 0.2, 1] as const;

function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < NAME_MIN) return `Use at least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `Keep it under ${NAME_MAX} characters.`;
  if (!/[\p{L}\p{N}]/u.test(name)) return 'Add at least one letter or number.';
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Could not create that intent';
}

/** "+ Custom Add": inline form that creates a custom intent (same endpoint as Profile). */
export default function SheetCustomAdd({ disabled, onCreated, onOpenChange }: SheetCustomAddProps) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<IntentVisibility>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // On phones and tablets the opened form (and its Add button) can sit below the fold or under
  // the on-screen keyboard: bring it into view once it has expanded and when the keyboard opens.
  const revealActions = React.useCallback(() => {
    actionsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [reduce]);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!open || !vv) return undefined;
    vv.addEventListener('resize', revealActions);
    return () => vv.removeEventListener('resize', revealActions);
  }, [open, revealActions]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (refocusToggle.current) {
      refocusToggle.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  const nameError = validateName(name);

  function collapse() {
    refocusToggle.current = true;
    setOpen(false);
    setName('');
    setVisibility('public');
    setError(null);
    setTouched(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (busy || nameError) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await createIntent({ name: name.trim(), visibility });
      emitPointsChanged();
      onCreated(intent?.name ?? name.trim());
      collapse();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    if (!busy) collapse();
  }

  const showError = touched && !!nameError;

  return (
    <div className="is-custom">
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          className="is-ghost-btn"
          disabled={disabled}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" size={14} strokeWidth={2} /> Custom Add
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.form
            key="is-custom-form"
            className="is-custom-form"
            onSubmit={submit}
            aria-label="Add a custom intent"
            aria-busy={busy}
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            onAnimationComplete={revealActions}
          >
            <div className="is-custom-inner">
              <label className="is-sr" htmlFor="is-custom-name">
                Custom intent name
              </label>
              <input
                id="is-custom-name"
                ref={inputRef}
                className="is-input"
                type="text"
                value={name}
                maxLength={NAME_MAX}
                placeholder="e.g. Indie hackers"
                autoComplete="off"
                disabled={busy}
                aria-invalid={showError}
                aria-describedby="is-custom-hint"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                onKeyDown={onKeyDown}
              />
              <p id="is-custom-hint" className={`is-hint${showError ? ' is-hint-err' : ''}`}>
                {showError ? nameError : `${name.trim().length}/${NAME_MAX}`}
              </p>
              <div className="is-vis" role="radiogroup" aria-label="Visibility">
                {(['public', 'private'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={visibility === v}
                    className={`is-vis-opt${visibility === v ? ' is-on' : ''}`}
                    disabled={busy}
                    onClick={() => setVisibility(v)}
                  >
                    <Icon name={v === 'public' ? 'globe' : 'lock'} size={12} />
                    {v === 'public' ? 'Public' : 'Private'}
                  </button>
                ))}
              </div>
              {error && (
                <p className="is-error-line" role="alert">
                  {error}
                </p>
              )}
              <div className="is-custom-actions" ref={actionsRef}>
                <button type="button" className="is-link" disabled={busy} onClick={collapse}>
                  Cancel
                </button>
                <button type="submit" className="is-add-btn" disabled={busy || !!nameError}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
