'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import NotePopover from './NotePopover';

export type SetupFooterProps = {
  /** Display labels of the selected intents. */
  labels: string[];
  note: string;
  onNoteChange: (note: string) => void;
  cost: number;
  balance: number | null;
  short: boolean;
  busy: boolean;
  canStart: boolean;
  error: string | null;
  onSubmit: () => void;
};

/** Anchored action bar: note, live summary and the Find-someone call to action. */
export default function SetupFooter({
  labels,
  note,
  onNoteChange,
  cost,
  balance,
  short,
  busy,
  canStart,
  error,
  onSubmit,
}: SetupFooterProps) {
  const reduce = useReducedMotion();
  const live = canStart && !reduce;

  return (
    <footer className="ss-footer">
      {error && (
        <p className="ss-error ss-footer__error" role="alert">
          {error}
        </p>
      )}
      <div className="ss-footer__row">
        <NotePopover note={note} onChange={onNoteChange} />

        <div className="ss-summary" aria-live="polite">
          <p className="ss-summary__on">
            {labels.length > 0 ? (
              <>
                <span className="ss-summary__lead">Matched on</span>
                <span className="ss-summary__list" title={labels.join(', ')}>
                  {labels.join(' · ')}
                </span>
              </>
            ) : (
              <span className="ss-summary__lead">Pick at least one intent to start</span>
            )}
          </p>
          <div className="ss-total">
            <span className="ss-total__label">Total</span>
            <span className="ss-total__value">
              <TokenCoin size={16} />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={cost}
                  initial={reduce ? false : { y: 12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { y: -12, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  {cost}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className={`ss-total__balance${short ? ' ss-total__balance--short' : ''}`}>
              Balance {balance ?? '—'}
            </span>
          </div>
        </div>

        <button
          type="button"
          className={`ss-cta${live ? ' ss-cta--live' : ''}`}
          disabled={!canStart}
          onClick={onSubmit}
        >
          {busy ? (
            <span className="ss-spinner" aria-label="Starting" />
          ) : short ? (
            'Not enough tokens'
          ) : (
            <>
              <span>
                Find someone · {cost} tokens
              </span>
              <span className="ss-cta__arrow">
                <Icon name="arrow-right" size={16} />
              </span>
            </>
          )}
        </button>
      </div>
    </footer>
  );
}
