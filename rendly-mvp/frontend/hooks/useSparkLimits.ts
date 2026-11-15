'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSparkLimits, type SparkLimits } from '@/services/sparkApi';

type Listener = (next: SparkLimits | null) => void;

/** Module-level store shared by every mounted useSparkLimits instance. */
let current: SparkLimits | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function publish(next: SparkLimits | null): void {
  current = next;
  listeners.forEach((listener) => listener(next));
}

/** One shared fetch; concurrent callers await the same promise. Errors keep the previous value. */
function fetchLimits(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = getSparkLimits()
    .then((limits) => publish({ ...limits }))
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Broadcast new limits. With `next`, every mounted hook gets that value without a fetch;
 * without it, one shared refetch is triggered.
 */
export function notifySparkLimitsChanged(next?: SparkLimits): void {
  if (next) {
    publish({ ...next });
    return;
  }
  void fetchLimits();
}

const MINUTE_MS = 60_000;

/** 'Resets in 42 min', 'Resets in 1 h 5 min', or '' when null, invalid or already past. */
export function formatResetsIn(resetsAt: string | null, now: number = Date.now()): string {
  if (!resetsAt) return '';
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return '';
  const diff = at - now;
  if (diff <= 0) return '';
  const totalMinutes = Math.max(1, Math.ceil(diff / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Resets in ${minutes} min`;
  if (minutes === 0) return `Resets in ${hours} h`;
  return `Resets in ${hours} h ${minutes} min`;
}

/** Current Spark balance + match allowance, shared across components and refreshed on focus. */
export function useSparkLimits(): { limits: SparkLimits | null; refresh: () => Promise<void> } {
  const [limits, setLimits] = useState<SparkLimits | null>(current);

  useEffect(() => {
    let active = true;
    const listener: Listener = (next) => {
      if (active) setLimits(next);
    };
    listeners.add(listener);
    if (current !== null) setLimits(current);
    void fetchLimits();

    const onFocus = () => {
      void fetchLimits();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      listeners.delete(listener);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const refresh = useCallback(() => fetchLimits(), []);

  return { limits, refresh };
}

/** Test-only: reset the shared store between tests. */
export function __resetSparkLimitsStore(): void {
  current = null;
  inFlight = null;
  listeners.clear();
}
