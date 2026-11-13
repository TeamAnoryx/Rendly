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
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import HotIntents from './HotIntents';
import LocationIntentPicker from './LocationIntentPicker';
import NearbyMapPanel from './NearbyMap';
import {
  MAX_SPARK_INTENTS,
  SPARK_NOTE_MAX,
  hashtagLabel,
  isSelected,
  toggleIntent,
  type SelectedIntent,
  type SelectedSource,
} from './setupUtils';
import './spark-setup.css';

export type SparkSetupProps = {
  busy: boolean;
  error: string | null;
  /** Restores the previous choice when coming back from the waiting screen. */
  initial?: JoinSparkInput | null;
  onStart: (input: JoinSparkInput) => void;
};

type Category = 'hot' | 'location' | 'nearby';
const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'hot', label: 'Hot', icon: 'flame' },
  { id: 'location', label: 'Location', icon: 'globe' },
  { id: 'nearby', label: 'Near By', icon: 'map-pin' },
];
const QUOTE_DEBOUNCE_MS = 400;

const PRESET_SET = new Set<string>(SPARK_PRESETS.map((p) => p.toLowerCase()));
function sourceFor(name: string): SelectedSource {
  return PRESET_SET.has(name.toLowerCase()) ? 'preset' : 'mine';
}

function Price({ value }: { value: number }) {
  return (
    <span className="ss-price">
      <TokenCoin size={13} />
      {value}
    </span>
  );
}

export default function SparkSetup({ busy, error, initial, onStart }: SparkSetupProps) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<SparkMode>(initial?.mode ?? 'text');
  const [selected, setSelected] = useState<SelectedIntent[]>(
    () => initial?.intents.map((name) => ({ name, source: sourceFor(name) })) ?? []
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false);
  const [category, setCategory] = useState<Category>('hot');
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

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.06 } },
  };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
      };
  const chipTap = reduce ? undefined : { scale: 0.94 };
  const spring = { type: 'spring' as const, stiffness: 520, damping: 30 };

  const chip = (name: string, source: SelectedSource, label: string) => {
    const on = isSelected(selected, name);
    return (
      <motion.button
        key={`${source}:${name}`}
        type="button"
        layout={!reduce}
        whileTap={chipTap}
        transition={spring}
        className={`ss-chip${on ? ' ss-chip--on' : ''}`}
        aria-pressed={on}
        disabled={!on && maxReached}
        onClick={() => toggle(name, source)}
      >
        {on && <Icon name="check" size={14} />}
        <span>{label}</span>
        <Price value={sparkIntentPrice(name)} />
      </motion.button>
    );
  };

  return (
    <div className="ss-root">
      <motion.div className="ss-body" variants={container} initial="hidden" animate="show">
        <motion.header className="ss-head" variants={item}>
          <h1 className="ss-title">Find your Spark</h1>
          <p className="ss-sub">Pick what you want to talk about. We match you with someone who shares your why.</p>
        </motion.header>

        <motion.section className="ss-section" variants={item}>
          <h2 className="ss-label">Format</h2>
          <div className="ss-seg" role="radiogroup" aria-label="Format">
            {(['text', 'video'] as SparkMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`ss-seg__btn${mode === m ? ' ss-seg__btn--on' : ''}`}
                onClick={() => setMode(m)}
              >
                <Icon name={m === 'text' ? 'chat' : 'video'} size={16} />
                {m === 'text' ? 'Text first' : 'Video'}
              </button>
            ))}
          </div>
        </motion.section>

        <motion.section className="ss-section" variants={item}>
          <h2 className="ss-label">Presets</h2>
          <div className="ss-chips">{SPARK_PRESETS.map((p) => chip(p, 'preset', p))}</div>
        </motion.section>

        <motion.section className="ss-section" variants={item}>
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
            <p className="ss-empty">No intents yet. Grab one from Hot, Location or Near By below.</p>
          )}
          {mine.length > 0 && <div className="ss-chips">{mine.map((i) => chip(i.name, 'mine', hashtagLabel(i.name)))}</div>}
        </motion.section>

        <motion.section className="ss-section" variants={item}>
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
                  {s.source === 'preset' ? s.name : hashtagLabel(s.name)}
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
        </motion.section>

        <motion.section className="ss-section" variants={item}>
          <div className="ss-tabs" role="tablist" aria-label="Discover intents">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                className={`ss-tab${category === c.id ? ' ss-tab--on' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                <Icon name={c.icon} size={15} />
                {c.label}
                {category === c.id && (
                  <motion.span layoutId={reduce ? undefined : 'ss-tab-ink'} className="ss-tab__ink" />
                )}
              </button>
            ))}
          </div>
          <div className="ss-tabpanel" role="tabpanel">
            {category === 'hot' && (
              <HotIntents
                selected={names}
                heldNames={mine.map((i) => i.name)}
                maxReached={maxReached}
                onSelect={(n) => toggle(n, 'hot')}
              />
            )}
            {category === 'location' && (
              <LocationIntentPicker selected={names} maxReached={maxReached} onSelect={(n) => toggle(n, 'location')} />
            )}
            {category === 'nearby' && (
              <NearbyMapPanel selected={names} maxReached={maxReached} onSelect={(n) => toggle(n, 'nearby')} />
            )}
          </div>
        </motion.section>

        <motion.section className="ss-section" variants={item}>
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
            className="ss-input ss-textarea"
            rows={3}
            maxLength={SPARK_NOTE_MAX}
            value={note}
            placeholder="Say what you are hoping to talk about"
            onChange={(e) => setNote(e.target.value.slice(0, SPARK_NOTE_MAX))}
          />
        </motion.section>

        <motion.section className="ss-section" variants={item}>
          <h2 className="ss-label">Privacy</h2>
          <div className="ss-seg" role="radiogroup" aria-label="Privacy">
            {[false, true].map((anon) => (
              <button
                key={String(anon)}
                type="button"
                role="radio"
                aria-checked={anonymous === anon}
                className={`ss-seg__btn${anonymous === anon ? ' ss-seg__btn--on' : ''}`}
                onClick={() => setAnonymous(anon)}
              >
                <Icon name={anon ? 'lock' : 'user'} size={16} />
                {anon ? 'Anonymous' : 'Public'}
              </button>
            ))}
          </div>
          <p className="ss-hint">
            {anonymous
              ? 'Your partner sees a nickname only. You can reveal yourself later.'
              : 'Your partner sees your name and profile photo.'}
          </p>
        </motion.section>
      </motion.div>

      <footer className="ss-footer">
        {error && (
          <p className="ss-error ss-footer__error" role="alert">
            {error}
          </p>
        )}
        <div className="ss-footer__row">
          <div className="ss-total">
            <span className="ss-total__label">Total</span>
            <span className="ss-total__value">
              <TokenCoin size={18} />
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
            <span className="ss-total__balance">Balance {balance ?? '—'}</span>
          </div>
          <button type="button" className="ss-btn ss-btn--primary" disabled={!canStart} onClick={submit}>
            {busy ? (
              <span className="ss-spinner" aria-label="Starting" />
            ) : short ? (
              'Not enough tokens'
            ) : (
              <>
                Find someone · {cost} tokens <Icon name="arrow-right" size={16} />
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
