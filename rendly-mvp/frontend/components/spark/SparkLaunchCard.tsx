'use client';

import React, { useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { SparkMode } from '@/services/sparkApi';
import type { SparkNotifyState } from '@/hooks/useSparkActive';
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
  /** People on Spark right now; null while unknown (Spark stays enabled). */
  activeCount?: number | null;
  notifyState?: SparkNotifyState;
  notifyMessage?: string | null;
  onNotify?: () => void;
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

function BellIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function activeLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'} on Spark now`;
}

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
  activeCount = null,
  notifyState = 'idle',
  notifyMessage = null,
  onNotify,
}: SparkLaunchCardProps) {
  const nobodyOn = activeCount === 0;
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

      {typeof activeCount === 'number' && activeCount > 0 && (
        <motion.p className="sl-live" variants={item} aria-live="polite">
          <span className="sl-live__dot" aria-hidden="true" />
          {activeLabel(activeCount)}
        </motion.p>
      )}

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
        <SparkButton busy={busy} onClick={onSpark} label="Spark" />

        {nobodyOn && (
          <div className="sl-empty" aria-live="polite">
            <p className="sl-empty__text">No one else is on Spark right now. Start anyway, or get an alert when people join.</p>
            {notifyState === 'done' ? (
              <p className="sl-notify sl-notify--done">
                <BellIcon /> We&apos;ll notify you
              </p>
            ) : (
              <button
                type="button"
                className="sl-notify"
                onClick={onNotify}
                disabled={!onNotify || notifyState === 'busy'}
              >
                <BellIcon /> {notifyState === 'busy' ? 'Turning on…' : 'Notify me'}
              </button>
            )}
            {notifyState === 'error' && notifyMessage && <p className="sl-empty__error">{notifyMessage}</p>}
          </div>
        )}

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
