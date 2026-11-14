'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  SPARK_PRESETS,
  getSparkQuote,
  sparkIntentPrice,
  sparkMatchCost,
  type JoinSparkInput,
  type SparkMode,
} from '@/services/sparkApi';
import { getMyIntents, type MyIntent } from '@/services/intentsApi';
import { POINTS_CHANGED_EVENT } from '@/services/pointsApi';
import { Icon } from '@/components/shell/Icon';
import {
  MAX_SPARK_INTENTS,
  hashtagLabel,
  isSelected,
  toggleIntent,
  type SelectedIntent,
  type SelectedSource,
} from './setupUtils';
import Segmented, { type SegmentOption } from './setup/Segmented';
import IntentChip from './setup/IntentChip';
import FitChips from './setup/FitChips';
import IntentExplorer from './setup/IntentExplorer';
import SetupFooter from './setup/SetupFooter';
import './spark-setup.css';
import './setup/setup-controls.css';

/** What the setup currently describes; drives the live match preview beside it. */
export type SetupSnapshot = {
  labels: string[];
  mode: SparkMode;
  anonymous: boolean;
  cost: number;
};

export type SparkSetupProps = {
  busy: boolean;
  error: string | null;
  /** Restores the previous choice when coming back from the waiting screen. */
  initial?: JoinSparkInput | null;
  onStart: (input: JoinSparkInput) => void;
  /** Called whenever the choice changes (presentation only). */
  onSnapshot?: (snapshot: SetupSnapshot) => void;
};

type Privacy = 'public' | 'anon';
const FORMATS: readonly SegmentOption<SparkMode>[] = [
  { value: 'text', label: 'Text first', icon: 'chat' },
  { value: 'video', label: 'Video', icon: 'video' },
];
const PRIVACY: readonly SegmentOption<Privacy>[] = [
  { value: 'public', label: 'Public', icon: 'user' },
  { value: 'anon', label: 'Anonymous', icon: 'lock' },
];
const QUOTE_DEBOUNCE_MS = 400;

const PRESET_SET = new Set<string>(SPARK_PRESETS.map((p) => p.toLowerCase()));
function sourceFor(name: string): SelectedSource {
  return PRESET_SET.has(name.toLowerCase()) ? 'preset' : 'mine';
}
function labelFor(s: SelectedIntent): string {
  return s.source === 'preset' ? s.name : hashtagLabel(s.name);
}

export default function SparkSetup({ busy, error, initial, onStart, onSnapshot }: SparkSetupProps) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<SparkMode>(initial?.mode ?? 'text');
  const [selected, setSelected] = useState<SelectedIntent[]>(
    () => initial?.intents.map((name) => ({ name, source: sourceFor(name) })) ?? []
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false);
  const [mine, setMine] = useState<MyIntent[]>([]);
  const [mineState, setMineState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [limitHit, setLimitHit] = useState(false);
  const [quote, setQuote] = useState<{ key: string; cost: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const names = useMemo(() => selected.map((s) => s.name), [selected]);
  const namesKey = names.join('\u0000');
  const maxReached = selected.length >= MAX_SPARK_INTENTS;

  const loadMine = useCallback(async () => {
    try {
      const list = await getMyIntents();
      setMine(list.filter((i) => i.kind !== 'preset'));
      setMineState('ok');
    } catch {
      setMineState('error');
    }
  }, []);

  const refreshQuote = useCallback(async (list: string[]) => {
    try {
      const q = await getSparkQuote(list);
      setBalance(q.balance);
      setQuote({ key: list.join('\u0000'), cost: q.cost });
    } catch {
      /* the local estimate stays on screen */
    }
  }, []);

  useEffect(() => {
    void loadMine();
    const onPoints = () => {
      void loadMine();
      void refreshQuote(names);
    };
    window.addEventListener(POINTS_CHANGED_EVENT, onPoints);
    return () => window.removeEventListener(POINTS_CHANGED_EVENT, onPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMine, refreshQuote, namesKey]);

  useEffect(() => {
    const t = window.setTimeout(() => void refreshQuote(names), QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, refreshQuote]);

  const localCost = sparkMatchCost(names);
  const cost = quote && quote.key === namesKey ? quote.cost : localCost;
  const short = balance !== null && cost > balance;
  const canStart = selected.length > 0 && !short && !busy;

  const toggle = (name: string, source: SelectedSource) => {
    const { next, limited } = toggleIntent(selected, { name, source });
    setLimitHit(limited);
    setSelected(next);
  };

  const submit = () => {
    if (!canStart) return;
    onStart({ mode, intents: names, note: note.trim() || undefined, anonymous });
  };

  const labels = useMemo(() => selected.map(labelFor), [selected]);
  const labelsKey = labels.join('\u0000');
  useEffect(() => {
    onSnapshot?.({ labels, mode, anonymous, cost });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelsKey, mode, anonymous, cost, onSnapshot]);

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.075, delayChildren: reduce ? 0 : 0.05 } },
  };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
        show: {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
        },
      };
  const spring = { type: 'spring' as const, stiffness: 520, damping: 30 };

  const chip = (name: string, source: SelectedSource, label: string) => {
    const on = isSelected(selected, name);
    return (
      <IntentChip
        label={label}
        price={sparkIntentPrice(name)}
        on={on}
        disabled={!on && maxReached}
        onToggle={() => toggle(name, source)}
      />
    );
  };

  return (
    <motion.div className="ss-root" variants={container} initial="hidden" animate="show">
      <div className="ss-grid">
        <motion.header className="ss-head" variants={item}>
          <div className="ss-head__text">
            <p className="ss-eyebrow">
              <Icon name="spark" size={13} /> One-to-one match
            </p>
            <h1 className="ss-title">
              Find your <span className="rd-spectrum-text ss-title__accent">Spark</span>
            </h1>
            <p className="ss-sub">Pick what you want to talk about. We match you with someone who shares your why.</p>
          </div>
          <div className="ss-config">
            <div className="ss-field">
              <h2 className="ss-label">Format</h2>
              <Segmented options={FORMATS} value={mode} onChange={setMode} label="Format" inkId="ss-format-ink" />
            </div>
            <div className="ss-field">
              <h2 className="ss-label">Privacy</h2>
              <Segmented
                options={PRIVACY}
                value={anonymous ? 'anon' : 'public'}
                onChange={(v) => setAnonymous(v === 'anon')}
                label="Privacy"
                inkId="ss-privacy-ink"
              />
              <p className="ss-hint ss-field__hint">
                {anonymous ? 'Partner sees a nickname. Reveal yourself later.' : 'Partner sees your name and photo.'}
              </p>
            </div>
          </div>
        </motion.header>

        <motion.section className="ss-presets" variants={item} aria-labelledby="ss-presets-h">
          <h2 className="ss-label" id="ss-presets-h">
            Presets
          </h2>
          <div className="ss-chips">
            {SPARK_PRESETS.map((p) => (
              <React.Fragment key={p}>{chip(p, 'preset', p)}</React.Fragment>
            ))}
          </div>
        </motion.section>

        <motion.section className="ss-card ss-card--intents" variants={item}>
          <div className="ss-block ss-block--mine">
            <h2 className="ss-label">My intents</h2>
            {mineState === 'loading' && <div className="ss-row ss-row--skeleton" />}
            {mineState === 'error' && (
              <p className="ss-empty">
                Could not load your intents.{' '}
                <button type="button" className="ss-link" onClick={() => void loadMine()}>
                  Retry
                </button>
              </p>
            )}
            {mineState === 'ok' && mine.length === 0 && (
              <p className="ss-empty">No intents yet. Grab one from Discover.</p>
            )}
            {mine.length > 0 && (
              <FitChips
                label="of your intents"
                chips={mine.map((i) => ({ key: i.name, node: chip(i.name, 'mine', hashtagLabel(i.name)) }))}
              />
            )}
          </div>

          <div className="ss-block ss-block--selected">
            <div className="ss-label-row">
              <h2 className="ss-label">Selected</h2>
              <span className={`ss-counter${limitHit ? ' ss-counter--warn' : ''}`}>
                {selected.length}/{MAX_SPARK_INTENTS}
              </span>
            </div>
            <div className="ss-tray" aria-live="polite">
              {selected.length === 0 && <span className="ss-hint">Choose up to {MAX_SPARK_INTENTS} intents.</span>}
              <AnimatePresence initial={false}>
                {selected.map((s) => (
                  <motion.span
                    key={s.name.toLowerCase()}
                    className="ss-tag"
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                    transition={spring}
                  >
                    {labelFor(s)}
                    <button
                      type="button"
                      className="ss-tag__x"
                      aria-label={`Remove ${s.name}`}
                      onClick={() => toggle(s.name, s.source)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            {limitHit && <p className="ss-hint ss-hint--warn">Up to {MAX_SPARK_INTENTS} intents per Spark.</p>}
          </div>
        </motion.section>

        <motion.section className="ss-card ss-card--explore" variants={item}>
          <IntentExplorer
            selected={names}
            heldNames={mine.map((i) => i.name)}
            maxReached={maxReached}
            onPick={(n, source) => toggle(n, source)}
          />
        </motion.section>
      </div>

      <motion.div className="ss-footer-slot" variants={item}>
        <SetupFooter
          labels={labels}
          note={note}
          onNoteChange={setNote}
          cost={cost}
          balance={balance}
          short={short}
          busy={busy}
          canStart={canStart}
          error={error}
          onSubmit={submit}
        />
      </motion.div>
    </motion.div>
  );
}
