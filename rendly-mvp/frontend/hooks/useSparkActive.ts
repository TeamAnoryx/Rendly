'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSparkActiveCount, requestSparkNotify } from '@/services/sparkApi';
import { pushSupported, subscribeToPush } from '@/lib/webPush';
import websocket from '@/services/websocket';

/** How often the live count is refreshed while the page is visible. */
export const SPARK_ACTIVE_POLL_MS = 10_000;

export type SparkNotifyState = 'idle' | 'busy' | 'done' | 'error';

/**
 * Live "N people on Spark now" count, polled every SPARK_ACTIVE_POLL_MS while the tab is
 * visible (refreshed at once when it becomes visible again). null until the first answer, and
 * after an error, so the UI never blocks Spark on a failed read.
 */
/**
 * People shown as "on Spark": everyone else with the Spark page open (socket lobby), or the
 * server's queue + live-match count, whichever is larger. Either source may be missing (null).
 */
export function combineSparkCounts(apiCount: number | null, lobbyCount: number | null): number | null {
  const others = lobbyCount === null ? null : Math.max(0, lobbyCount - 1);
  if (apiCount === null) return others;
  if (others === null) return apiCount;
  return Math.max(apiCount, others);
}

/** Puts this user in the Spark lobby while `enabled`; returns how many people have the page open. */
export function useSparkLobbyCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const enter = () => {
      websocket
        .emitWithAck<{ ok?: boolean; count?: number }>('spark:lobby', { present: true })
        .then((res) => alive && typeof res?.count === 'number' && setCount(res.count))
        .catch(() => undefined);
    };
    const off = websocket.on<{ count?: number }>('spark:lobby-count', (p) => {
      if (typeof p?.count === 'number') setCount(p.count);
    });
    // Rejoin after a reconnect: the server forgets lobby sockets that dropped.
    const offStatus = websocket.onStatus((connected) => connected && enter());
    if (websocket.isConnected()) enter();
    return () => {
      alive = false;
      off();
      offStatus();
      websocket.emit('spark:lobby', { present: false });
      setCount(null);
    };
  }, [enabled]);

  return count;
}

export function useSparkActiveCount(enabled = true): number | null {
  const lobby = useSparkLobbyCount(enabled);
  const api = useSparkApiCount(enabled);
  return combineSparkCounts(api, lobby);
}

function useSparkApiCount(enabled: boolean): number | null {
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
