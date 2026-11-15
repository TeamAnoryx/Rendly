'use client';

import React, { useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { SparkMode } from '@/services/sparkApi';
import Segmented from '@/components/spark/setup/Segmented';
import SparkButton from '@/components/spark/SparkButton';
import { TokenCoin } from '@/components/brand/TokenCoin';
import './setup/setup-controls.css';
import './spark-launch.css';

export type SparkLaunchCardProps = {
  mode: SparkMode;
  anonymous: boolean;
  note: string;
  busy: boolean;
  error: string | null;
  cost?: number | null;
  onModeChange: (m: SparkMode) => void;
  onAnonymousChange: (a: boolean) => void;
  onNoteChange: (n: string) => void;
  onSpark: () => void;
};

/** Matches backend MATCH_NOTE_MAX in backend/services/auth-service/src/spark-rules.ts. */
export const SPARK_NOTE_MAX = 200;
const COUNTER_THRESHOLD = 160;
const EASE = [0.2, 0.8, 0.2, 1] as const;

type Privacy = 'public' | 'anon';

const FORMAT_OPTIONS = [
  { value: 'text', label: 'Text first', icon: 'chat' },
  { value: 'video', label: 'Video', icon: 'video' },
] as const;

const PRIVACY_OPTIONS = [
  { value: 'public', label: 'Public', icon: 'user' },
  { value: 'anon', label: 'Anonymous', icon: 'lock' },
] as const;

export default function SparkLaunchCard({
  mode,
  anonymous,
  note,
  busy,
  error,
  cost,
  onModeChange,
  onAnonymousChange,
  onNoteChange,
  onSpark,
}: SparkLaunchCardProps) {
  const reduce = useReducedMotion();
  const uid = useId();
  const noteId = `${uid}-note`;
  const privacyHintId = `${uid}-privacy-hint`;
  const [noteFocused, setNoteFocused] = useState(false);
  const showCounter = noteFocused || note.length > COUNTER_THRESHOLD;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.06 } },
  };
  const item = reduce
    ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } }
    : {
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
      };

  return (
    <motion.section
      className="sl-card"
      aria-label="Start a Spark"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <span className="sl-card__ring" aria-hidden="true" />

      <motion.div className="sl-field" variants={item}>
        <span className="sl-label" aria-hidden="true">
          Format
        </span>
        <Segmented<SparkMode>
          options={FORMAT_OPTIONS}
          value={mode}
          onChange={onModeChange}
          label="Format"
          inkId="sl-format-ink"
          className="sl-seg"
        />
      </motion.div>

      <motion.div className="sl-field" variants={item}>
        <span className="sl-label" aria-hidden="true">
          Privacy
        </span>
        <Segmented<Privacy>
          options={PRIVACY_OPTIONS}
          value={anonymous ? 'anon' : 'public'}
          onChange={(v) => onAnonymousChange(v === 'anon')}
          label="Privacy"
          inkId="sl-privacy-ink"
          className="sl-seg"
        />
        <p className="sl-hint" id={privacyHintId}>
          {anonymous
            ? 'Partner sees a nickname. Reveal yourself later.'
            : 'Partner sees your name and photo.'}
        </p>
      </motion.div>

      <motion.div className="sl-field" variants={item}>
        <div className="sl-label-row">
          <label className="sl-label" htmlFor={noteId}>
            Add a note
          </label>
          {showCounter && (
            <span
              className={`sl-counter${note.length >= SPARK_NOTE_MAX ? ' sl-counter--max' : ''}`}
              aria-live="polite"
            >
              {note.length}/{SPARK_NOTE_MAX}
            </span>
          )}
        </div>
        <input
          id={noteId}
          type="text"
          className="rd-input sl-note"
          value={note}
          maxLength={SPARK_NOTE_MAX}
          placeholder="Add a note (optional)"
          autoComplete="off"
          onChange={(e) => onNoteChange(e.target.value.slice(0, SPARK_NOTE_MAX))}
          onFocus={() => setNoteFocused(true)}
          onBlur={() => setNoteFocused(false)}
        />
      </motion.div>

      <motion.div className="sl-cta" variants={item}>
        <SparkButton busy={busy} disabled={false} onClick={onSpark} label="Spark" />

        {typeof cost === 'number' && (
          <p className="sl-cost">
            <TokenCoin size={14} />
            <span>
              {cost} {cost === 1 ? 'token' : 'tokens'}
            </span>
          </p>
        )}

        {error && (
          <p className="sl-error" role="alert" aria-live="polite">
            {error}
          </p>
        )}
      </motion.div>
    </motion.section>
  );
}
