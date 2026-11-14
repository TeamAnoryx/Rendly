'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { SPARK_NOTE_MAX } from '../setupUtils';
import { useDismiss } from './useDismiss';

export type NotePopoverProps = {
  note: string;
  onChange: (note: string) => void;
};

/** Optional note, collapsed into a pill that opens a small editor above it. */
export default function NotePopover({ note, onChange }: NotePopoverProps) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, close);

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  const preview = note.trim();

  return (
    <div className="ss-note" ref={wrapRef}>
      <button
        type="button"
        className={`ss-note__pill${preview ? ' ss-note__pill--filled' : ''}`}
        aria-expanded={open}
        aria-controls="ss-note-pop"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="chat" size={14} />
        <span className="ss-note__text">{preview || 'Add a note'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id="ss-note-pop"
            className="ss-pop ss-pop--note"
            role="dialog"
            aria-label="Note"
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="ss-label-row">
              <label className="ss-label" htmlFor="ss-note">
                Note <span className="ss-optional">optional</span>
              </label>
              <span className="ss-counter">
                {note.length}/{SPARK_NOTE_MAX}
              </span>
            </div>
            <textarea
              id="ss-note"
              ref={fieldRef}
              className="ss-input ss-textarea"
              rows={4}
              maxLength={SPARK_NOTE_MAX}
              value={note}
              placeholder="Say what you are hoping to talk about"
              onChange={(e) => onChange(e.target.value.slice(0, SPARK_NOTE_MAX))}
            />
            <div className="ss-pop__actions">
              <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={close}>
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
