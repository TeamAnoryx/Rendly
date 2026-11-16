'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  SparkInsufficientError,
  getSparkStatus,
  leaveSparkQueue,
  sparkMatchCost,
  type JoinSparkInput,
  type SparkMatched,
  type SparkMode,
  type SparkView,
} from '@/services/sparkApi';
import { useDashboard } from '@/hooks/useDashboard';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import type { SetupSnapshot } from '@/components/spark/SparkSetup';
import SparkLaunchCard from '@/components/spark/SparkLaunchCard';
import IntentSheet from '@/components/spark/IntentSheet';
import {
  SparkRateLimitError,
  hasSeenIntentSheet,
  joinSparkWithLimits,
  markIntentSheetSeen,
  normalizeNote,
  rateLimitMessage,
} from '@/components/spark/launch/sparkLaunch';
import { useSparkQuote } from '@/hooks/useSparkQuote';
import { useSparkActiveCount, useSparkNotify } from '@/hooks/useSparkActive';
import MatchPreview from '@/components/spark/MatchPreview';
import { SparkRoom } from '@/components/spark/SparkRoom';
import { hashtagLabel } from '@/components/spark/setupUtils';
import PovOrbit from '@/components/motion/PovOrbit';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import '@/components/spark/sheet/default-match-toggle.css';
import './match.css';

type Phase = 'loading' | 'choose' | 'waiting' | 'room';
type WaitingInfo = { intents: string[]; cost: number; mode: SparkMode };

/** Remembers the Default (guaranteed match) choice; on unless the user turned it off. */
const DEFAULT_MATCH_KEY = 'rendly_spark_default_match';

function readDefaultMatch(): boolean {
  try {
    return window.localStorage.getItem(DEFAULT_MATCH_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeDefaultMatch(on: boolean): void {
  try {
    window.localStorage.setItem(DEFAULT_MATCH_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

/** Queue polling while waiting: fast for the first FAST_POLL_WINDOW_MS, then slower. */
const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 3000;
const FAST_POLL_WINDOW_MS = 10_000;
const NOT_ENOUGH = 'Not enough tokens';
const NO_INTENTS: readonly string[] = [];

function insufficientMessage(cost: number, balance: number): string {
  return `${NOT_ENOUGH}: this Spark costs ${cost} and you have ${balance}.`;
}

function waitingSnapshot(info: WaitingInfo, anonymous: boolean): SetupSnapshot {
  return { labels: info.intents.map(hashtagLabel), mode: info.mode, anonymous, cost: info.cost };
}

function WaitingScreen({ info, matchAny, onCancel }: { info: WaitingInfo; matchAny: boolean; onCancel: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="sw-root"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      role="status"
      aria-live="polite"
    >
      <div className={`sw-radar${reduce ? ' sw-radar--still' : ''}`} aria-hidden="true">
        <span className="sw-radar__ring" />
        <span className="sw-radar__ring" />
        <span className="sw-radar__ring" />
        <span className="sw-radar__sweep" />
        <span className="sw-radar__core">
          <Icon name="spark" size={26} />
        </span>
      </div>
      <h1 className="sw-title">Looking for your Spark…</h1>
      <p className="sw-sub">
        {info.mode === 'video' ? 'Video' : 'Text first'} · We will connect you the moment someone shares your why.
      </p>
      <div className="sw-chips">
        {info.intents.map((name) => (
          <span key={name} className="sw-chip">
            {hashtagLabel(name)}
          </span>
        ))}
        {matchAny ? (
          <span className="sw-default" title="No one shares your intents? We pair you with another Default user (+5 tokens, only if used).">
            <Icon name="check" size={12} /> Default · guaranteed match
          </span>
        ) : null}
      </div>
      <p className="sw-cost">
        <TokenCoin size={16} /> Charged only for intents you share, after 30s together
      </p>
      <button type="button" className="sw-cancel" onClick={onCancel}>
        Cancel
      </button>
    </motion.div>
  );
}

export default function SparkPage() {
  const { user } = useDashboard();
  usePresenceHeartbeat(Boolean(user));

  const [phase, setPhase] = useState<Phase>('loading');
  const [waiting, setWaiting] = useState<WaitingInfo | null>(null);
  const [match, setMatch] = useState<SparkMatched | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastInputRef = useRef<JoinSparkInput | null>(null);
  /** True while a join is in flight: a status poll then may still see the pairing being skipped. */
  const joiningRef = useRef(false);
  const [mode, setMode] = useState<SparkMode>('text');
  const [anonymous, setAnonymous] = useState(false);
  const [matchAny, setMatchAny] = useState(true);
  useEffect(() => setMatchAny(readDefaultMatch()), []);
  const changeMatchAny = useCallback((on: boolean) => {
    setMatchAny(on);
    writeDefaultMatch(on);
  }, []);
  const [note, setNote] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastIntents, setLastIntents] = useState<readonly string[]>(NO_INTENTS);
  /** Matches the user asked for in this run (from the sheet's limiter); null = no cap. */
  const matchBudgetRef = useRef<number | null>(null);
  const quote = useSparkQuote(lastIntents);
  const activeCount = useSparkActiveCount(phase === 'choose');
  const sparkNotify = useSparkNotify();
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  /** Apply a server view to the screen. `fromWaiting` means we were already queued. */
  const applyView = useCallback((view: SparkView, fromWaiting: boolean) => {
    switch (view.status) {
      case 'matched':
        // Entering a new room uses one match of the run.
        if (phaseRef.current !== 'room' && matchBudgetRef.current !== null) {
          matchBudgetRef.current = Math.max(0, matchBudgetRef.current - 1);
        }
        setMatch(view);
        setPhase('room');
        return;
      case 'waiting':
        setWaiting({ intents: view.intents, cost: view.cost, mode: view.mode });
        if (!lastInputRef.current) {
          lastInputRef.current = { mode: view.mode, intents: view.intents, anonymous: true };
          setMode(view.mode);
          setLastIntents(view.intents);
        }
        setPhase('waiting');
        return;
      case 'insufficient':
        setError(insufficientMessage(view.cost, view.balance));
        setPhase('choose');
        return;
      default:
        if (fromWaiting) setError('Your search ended. Start a new one when you are ready.');
        setPhase('choose');
    }
  }, []);

  // Resume an existing search or match on mount.
  useEffect(() => {
    let alive = true;
    getSparkStatus()
      .then((view) => alive && applyView(view, false))
      .catch(() => alive && setPhase('choose'));
    return () => {
      alive = false;
    };
  }, [applyView]);

  // Poll while waiting: at once, then every 1.5s for the first 10s, then every 3s.
  useEffect(() => {
    if (phase !== 'waiting') return;
    let alive = true;
    let timer: number | undefined;
    const startedAt = Date.now();
    const poll = () => {
      getSparkStatus()
        .then((view) => {
          if (alive && !joiningRef.current && phaseRef.current === 'waiting') applyView(view, true);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!alive || phaseRef.current !== 'waiting') return;
          const delay = Date.now() - startedAt < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
          timer = window.setTimeout(poll, delay);
        });
    };
    poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [phase, applyView]);

  // Leave the queue if the page unmounts mid-search.
  useEffect(
    () => () => {
      if (phaseRef.current === 'waiting') void leaveSparkQueue().catch(() => undefined);
    },
    []
  );

  const join = useCallback(
    async (input: JoinSparkInput) => {
      lastInputRef.current = input;
      setLastIntents(input.intents);
      setError(null);
      setBusy(true);
      joiningRef.current = true;
      try {
        applyView(await joinSparkWithLimits(input), false);
      } catch (e) {
        if (e instanceof SparkRateLimitError) setError(rateLimitMessage(e));
        else if (e instanceof SparkInsufficientError) setError(insufficientMessage(e.cost, e.balance));
        else setError(e instanceof Error ? e.message : 'Could not start your Spark');
        setPhase('choose');
      } finally {
        joiningRef.current = false;
        setBusy(false);
      }
    },
    [applyView]
  );

  /** Card CTA: first Spark of the session (or no intents yet) opens the sheet; later ones re-queue directly. */
  const onLaunch = useCallback(() => {
    if (lastIntents.length > 0 && hasSeenIntentSheet()) {
      void join({ mode, anonymous, note: normalizeNote(note), intents: [...lastIntents], match_any: matchAny });
      return;
    }
    setSheetOpen(true);
  }, [lastIntents, mode, anonymous, note, join, matchAny]);

  const onSheetSpark = useCallback(
    (intents: string[], matches: number) => {
      matchBudgetRef.current = matches;
      markIntentSheetSeen();
      setSheetOpen(false);
      void join({ mode, anonymous, note: normalizeNote(note), intents, match_any: matchAny });
    },
    [mode, anonymous, note, join, matchAny]
  );

  const liveCost = lastIntents.length > 0 ? (quote.cost ?? sparkMatchCost(lastIntents)) : null;
  const snapshot = useMemo<SetupSnapshot>(
    () => ({ labels: lastIntents.map(hashtagLabel), mode, anonymous, cost: liveCost ?? 0 }),
    [lastIntents, mode, anonymous, liveCost]
  );

  const cancel = useCallback(async () => {
    setPhase('choose');
    await leaveSparkQueue().catch(() => undefined);
  }, []);

  /**
   * Skip: show the searching screen at once (no blank frame), then re-queue. Joining the queue
   * ends and settles the old pairing server-side, so no separate leave call is needed.
   */
  const skip = useCallback(async () => {
    const input = lastInputRef.current;
    setMatch(null);
    if (matchBudgetRef.current === 0) {
      matchBudgetRef.current = null;
      phaseRef.current = 'choose';
      setPhase('choose');
      setError('That was your last match for this run. Spark again for more.');
      await leaveSparkQueue().catch(() => undefined);
      return;
    }
    if (!input) {
      phaseRef.current = 'choose';
      setPhase('choose');
      await leaveSparkQueue().catch(() => undefined);
      return;
    }
    setWaiting((prev) => prev ?? { intents: input.intents, cost: sparkMatchCost(input.intents), mode: input.mode });
    phaseRef.current = 'waiting';
    setPhase('waiting');
    await join(input);
  }, [join]);

  /** End the match server-side too, so it settles (charged after 30s, waived before) instead of staying pending. */
  const leave = useCallback(() => {
    setMatch(null);
    setPhase('choose');
    void leaveSparkQueue().catch(() => undefined);
  }, []);

  const inRoom = phase === 'room' && match !== null;
  const myMode = lastInputRef.current?.mode ?? match?.mode ?? 'text';

  return (
    <div className={`spark-shell${inRoom ? ' spark-shell--room' : ''}`}>
      {inRoom ? (
        <div className="spark-room-slot">
          <SparkRoom match={match} myMode={myMode} selfAnonymous={lastInputRef.current?.anonymous ?? true} onSkip={() => void skip()} onLeave={leave} />
        </div>
      ) : (
        <>
          <section className="spark-main">
            {phase === 'loading' && (
              <div className="spark-loading" role="status">
                <span className="ss-spinner" aria-label="Loading" />
              </div>
            )}
            {phase === 'choose' && (
              <div className="spark-launch-col">
                <header className="spark-hero">
                  <p className="spark-hero__eyebrow">
                    <Icon name="spark" size={13} /> One-to-one match
                  </p>
                  <h1 className="spark-hero__title">
                    Find your <span className="rd-spectrum-text">Spark</span>
                  </h1>
                  <p className="spark-hero__sub">Pick a format, add a note, then tell us your why.</p>
                </header>
                <SparkLaunchCard
                  mode={mode}
                  anonymous={anonymous}
                  note={note}
                  busy={busy}
                  error={error}
                  cost={liveCost}
                  onModeChange={setMode}
                  onAnonymousChange={setAnonymous}
                  onNoteChange={setNote}
                  onSpark={onLaunch}
                  activeCount={activeCount}
                  notifyState={sparkNotify.state}
                  notifyMessage={sparkNotify.message}
                  onNotify={sparkNotify.notify}
                />
                {lastIntents.length > 0 && hasSeenIntentSheet() && (
                  <div className="spark-last-intents">
                    <span className="spark-last-intents__label">Sparking on</span>
                    <span className="spark-last-intents__tags">{lastIntents.map(hashtagLabel).join(' ')}</span>
                    <button
                      type="button"
                      className="spark-last-intents__change"
                      onClick={() => setSheetOpen(true)}
                      disabled={busy}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            )}
            {phase === 'waiting' && waiting && <WaitingScreen info={waiting} matchAny={lastInputRef.current?.match_any ?? matchAny} onCancel={() => void cancel()} />}
            <IntentSheet
              open={sheetOpen && phase === 'choose'}
              mode={mode}
              anonymous={anonymous}
              note={note}
              matchAny={matchAny}
              onMatchAnyChange={changeMatchAny}
              onClose={() => setSheetOpen(false)}
              onSpark={onSheetSpark}
            />
          </section>
          <aside className="spark-orbit-panel" aria-label="Match preview">
            <div className="spark-orbit-panel__glow" aria-hidden="true" />
            <PovOrbit className="spark-orbit" parallax burst burstDelayMs={250} />
            <div className="spark-orbit-panel__veil" aria-hidden="true" />
            <div id="spark-map-slot" />
            <div id="spark-side-slot" />
            <div className="spark-orbit-panel__overlay">
              <MatchPreview snapshot={phase === 'waiting' && waiting ? waitingSnapshot(waiting, lastInputRef.current?.anonymous ?? false) : snapshot} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
