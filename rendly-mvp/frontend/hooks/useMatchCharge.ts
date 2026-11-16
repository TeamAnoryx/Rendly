'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { settleMatch, type SparkCharge, type SparkChargeState } from '@/services/sparkApi';
import { notifySparkLimitsChanged } from '@/hooks/useSparkLimits';
import { emitPointsChanged } from '@/services/pointsApi';

/** Length of the free window: a match is only charged once it lasts this long. */
export const SPARK_FREE_SECONDS = 30;

const TICK_MS = 250;
/** Settle is retried this often while the server still reports pending (or fails). */
export const SETTLE_RETRY_MS = 1500;
/** Settle attempts before giving up; status polling still adopts the final state. */
export const SETTLE_MAX_TRIES = 10;
const FREE_MS = SPARK_FREE_SECONDS * 1000;
/** The server charges a settle up to 1 s early, so the client only waives before this margin. */
const SETTLE_TOLERANCE_MS = 1000;

export type MatchChargeView = {
  state: 'pending' | 'charged' | 'waived';
  secondsLeft: number;
  /** 0..1 share of the free window that has elapsed. */
  progress: number;
  cost: number;
};

/** Deadline (ms epoch) from settles_at, falling back to now + 30 s when missing or invalid. */
function resolveDeadline(settlesAt: string | null | undefined): number {
  const parsed = settlesAt ? Date.parse(settlesAt) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now() + FREE_MS;
}

/**
 * Tracks the 30 s free window of a Spark match and settles the charge once it elapses.
 * Without a `charge` (older backend) the window starts at mount and cost is 0.
 */
export function useMatchCharge(
  charge: SparkCharge | undefined,
): MatchChargeView & { markEnded: () => void } {
  const settlesKey = charge?.settles_at ?? null;

  const [deadline, setDeadline] = useState(() => resolveDeadline(settlesKey));
  const [state, setState] = useState<SparkChargeState>(charge?.state ?? 'pending');
  const [cost, setCost] = useState<number>(charge?.cost ?? 0);
  const [now, setNow] = useState(() => Date.now());

  const generationRef = useRef(0);
  const settlingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  const deadlineRef = useRef(deadline);
  const prevKeyRef = useRef(settlesKey);
  stateRef.current = state;
  deadlineRef.current = deadline;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  // New match (settles_at changed): reset everything.
  useEffect(() => {
    if (prevKeyRef.current === settlesKey) return;
    prevKeyRef.current = settlesKey;
    generationRef.current += 1;
    settlingRef.current = false;
    clearRetry();
    setDeadline(resolveDeadline(settlesKey));
    setState(charge?.state ?? 'pending');
    setCost(charge?.cost ?? 0);
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlesKey, clearRetry]);

  // Adopt settled states and cost pushed from the server (status polling).
  const propState = charge?.state;
  const propCost = charge?.cost;
  useEffect(() => {
    if (propState && propState !== 'pending') setState(propState);
    if (typeof propCost === 'number' && Number.isFinite(propCost)) setCost(propCost);
  }, [propState, propCost]);

  const expired = now >= deadline;

  // Tick while pending and inside the free window.
  useEffect(() => {
    if (state !== 'pending' || expired) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [state, expired]);

  // Settle when the window elapses. While the server still answers pending (clock drift),
  // has no pairing yet, or fails, retry every SETTLE_RETRY_MS up to SETTLE_MAX_TRIES times.
  useEffect(() => {
    if (state !== 'pending' || !expired || settlingRef.current) return;
    settlingRef.current = true;
    const generation = generationRef.current;

    const retry = (triesLeft: number) => {
      if (generation !== generationRef.current) return;
      if (triesLeft <= 0) {
        settlingRef.current = false;
        return;
      }
      retryTimerRef.current = setTimeout(() => attempt(triesLeft), SETTLE_RETRY_MS);
    };

    const attempt = (triesLeft: number) => {
      settleMatch()
        .then((res) => {
          if (generation !== generationRef.current) return;
          notifySparkLimitsChanged(res.limits);
          if (res.charge) setCost(res.charge.cost);
          if (res.charge && res.charge.state !== 'pending') {
            setState(res.charge.state);
            return;
          }
          retry(triesLeft - 1);
        })
        .catch(() => retry(triesLeft - 1));
    };
    attempt(SETTLE_MAX_TRIES);
  }, [state, expired]);

  // Once charged, the balance and token history changed: refresh them everywhere.
  useEffect(() => {
    if (state === 'charged') emitPointsChanged();
  }, [state]);

  useEffect(() => clearRetry, [clearRetry]);

  // Skipping inside the free window: neither side pays. After it (or within the server's
  // 1 s tolerance) both pay, so the settle above resolves the charge instead.
  const markEnded = useCallback(() => {
    if (stateRef.current === 'pending' && Date.now() < deadlineRef.current - SETTLE_TOLERANCE_MS) {
      generationRef.current += 1;
      clearRetry();
      setState('waived');
    }
    notifySparkLimitsChanged();
  }, [clearRetry]);

  const pending = state === 'pending';
  const remainingMs = pending ? Math.max(0, deadline - now) : 0;
  const secondsLeft = remainingMs / 1000;
  const progress = pending ? Math.min(1, Math.max(0, 1 - remainingMs / FREE_MS)) : 1;

  return { state, secondsLeft, progress, cost, markEnded };
}
