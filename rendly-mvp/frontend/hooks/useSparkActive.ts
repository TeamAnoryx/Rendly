'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSparkActiveCount, requestSparkNotify } from '@/services/sparkApi';
import { pushSupported, subscribeToPush } from '@/lib/webPush';

/** How often the live count is refreshed while the page is visible. */
export const SPARK_ACTIVE_POLL_MS = 10_000;

export type SparkNotifyState = 'idle' | 'busy' | 'done' | 'error';

/**
 * Live "N people on Spark now" count, polled every SPARK_ACTIVE_POLL_MS while the tab is
 * visible (refreshed at once when it becomes visible again). null until the first answer, and
 * after an error, so the UI never blocks Spark on a failed read.
 */
export function useSparkActiveCount(enabled = true): number | null {
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      getSparkActiveCount()
        .then((n) => alive && setActive(n))
        .catch(() => alive && setActive(null));
    };
    const start = () => {
      if (timer) return;
      refresh();
      timer = setInterval(refresh, SPARK_ACTIVE_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return active;
}

/**
 * "Notify me": ask for notification permission when needed, subscribe this browser to push,
 * then ask the server for a push once people are matching on Spark.
 */
export function useSparkNotify(): { state: SparkNotifyState; message: string | null; notify: () => void } {
  const [state, setState] = useState<SparkNotifyState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const notify = useCallback(() => {
    if (state === 'busy' || state === 'done') return;
    setState('busy');
    setMessage(null);
    void (async () => {
      try {
        if (!pushSupported()) throw new Error('This browser cannot show notifications.');
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission !== 'granted') throw new Error('Allow notifications to get an alert.');
        if (!(await subscribeToPush())) throw new Error('Notifications are not available right now.');
        await requestSparkNotify();
        setState('done');
      } catch (e) {
        setState('error');
        setMessage(e instanceof Error ? e.message : 'Could not turn on the alert.');
      }
    })();
  }, [state]);

  return { state, message, notify };
}
