'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  SparkInsufficientError,
  getSparkStatus,
  joinSparkQueue,
  leaveSparkQueue,
  type JoinSparkInput,
  type SparkMatched,
  type SparkMode,
  type SparkView,
} from '@/services/sparkApi';
import { useDashboard } from '@/hooks/useDashboard';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import SparkSetup from '@/components/spark/SparkSetup';
import { SparkRoom } from '@/components/spark/SparkRoom';
import { hashtagLabel } from '@/components/spark/setupUtils';
import PovOrbit from '@/components/motion/PovOrbit';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import './match.css';

type Phase = 'loading' | 'choose' | 'waiting' | 'room';
type WaitingInfo = { intents: string[]; cost: number; mode: SparkMode };

/** How often the queue is polled while waiting for a partner. */
const POLL_MS = 3000;
const NOT_ENOUGH = 'Not enough tokens';

function insufficientMessage(cost: number, balance: number): string {
  return `${NOT_ENOUGH}: this Spark costs ${cost} and you have ${balance}.`;
}

function WaitingScreen({ info, onCancel }: { info: WaitingInfo; onCancel: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="sw-root"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
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
      </div>
      <p className="sw-cost">
        <TokenCoin size={16} /> {info.cost} tokens when matched
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
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  /** Apply a server view to the screen. `fromWaiting` means we were already queued. */
  const applyView = useCallback((view: SparkView, fromWaiting: boolean) => {
    switch (view.status) {
      case 'matched':
        setMatch(view);
        setPhase('room');
        return;
      case 'waiting':
        setWaiting({ intents: view.intents, cost: view.cost, mode: view.mode });
        if (!lastInputRef.current) {
          lastInputRef.current = { mode: view.mode, intents: view.intents, anonymous: true };
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

  // Poll while waiting.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const id = window.setInterval(() => {
      getSparkStatus()
        .then((view) => {
          if (phaseRef.current === 'waiting') applyView(view, true);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
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
      setError(null);
      setBusy(true);
      try {
        applyView(await joinSparkQueue(input), false);
      } catch (e) {
        if (e instanceof SparkInsufficientError) setError(insufficientMessage(e.cost, e.balance));
        else setError(e instanceof Error ? e.message : 'Could not start your Spark');
        setPhase('choose');
      } finally {
        setBusy(false);
      }
    },
    [applyView]
  );

  const cancel = useCallback(async () => {
    setPhase('choose');
    await leaveSparkQueue().catch(() => undefined);
  }, []);

  const skip = useCallback(async () => {
    const input = lastInputRef.current;
    setMatch(null);
    await leaveSparkQueue().catch(() => undefined);
    if (input) await join(input);
    else setPhase('choose');
  }, [join]);

  const leave = useCallback(() => {
    setMatch(null);
    setPhase('choose');
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
              <SparkSetup busy={busy} error={error} initial={lastInputRef.current} onStart={(i) => void join(i)} />
            )}
            {phase === 'waiting' && waiting && <WaitingScreen info={waiting} onCancel={() => void cancel()} />}
          </section>
          <aside className="spark-orbit-panel" aria-hidden="true">
            <PovOrbit className="spark-orbit" parallax />
            <div className="spark-orbit-panel__veil" />
            <p className="spark-orbit-panel__caption">People who share your why</p>
          </aside>
        </>
      )}
    </div>
  );
}
