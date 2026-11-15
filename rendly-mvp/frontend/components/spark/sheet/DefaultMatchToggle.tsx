'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './default-match-toggle.css';

/** Extra tokens charged only when the Default fallback makes the match (backend SPARK_DEFAULT_FEE). */
export const SPARK_DEFAULT_FEE = 5;

export type DefaultMatchToggleProps = {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Show the explanation next to the pill. */
  withHint?: boolean;
};

function BoxIcon({ checked }: { checked: boolean }) {
  return (
    <svg className="dmt-box" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {checked ? (
        <motion.path
          d="M4.6 8.2l2.3 2.3 4.6-4.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      ) : null}
    </svg>
  );
}

/**
 * Default (guaranteed match): when nobody shares the user's intents within a few seconds,
 * Spark pairs them with another Default user. +5 tokens, only when that fallback is used.
 */
export default function DefaultMatchToggle({ on, onChange, withHint = true }: DefaultMatchToggleProps) {
  const reduce = useReducedMotion();
  return (
    <div className="dmt">
      <motion.button
        type="button"
        className={`dmt-pill${on ? ' dmt-pill--on' : ' dmt-pill--off'}${reduce ? ' dmt-pill--still' : ''}`}
        aria-pressed={on}
        aria-label={`Default guaranteed match ${on ? 'on' : 'off'}`}
        onClick={() => onChange(!on)}
        whileTap={reduce ? undefined : { scale: 0.95 }}
        layout={!reduce}
      >
        <BoxIcon checked={on} />
        <span>Default</span>
      </motion.button>
      {withHint ? (
        <p className="dmt-hint">
          {on ? (
            <>
              <strong>Guaranteed match.</strong> No one shares your intents? We pair you with another Default user. +
              {SPARK_DEFAULT_FEE} tokens, only if used.
            </>
          ) : (
            <>Select to get a guaranteed match.</>
          )}
        </p>
      ) : null}
    </div>
  );
}
