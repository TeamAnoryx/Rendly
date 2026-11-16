'use client';

import { useEffect, useRef } from 'react';
import websocket from '@/services/websocket';

/**
 * Thin typed wrappers over the shared websocket for the Spark room.
 * Every event is scoped to the matched pair server-side, so payloads never carry user ids.
 */

export type SparkSignalKind = 'offer' | 'answer' | 'ice';
export type SparkSignal = { kind: SparkSignalKind; data: unknown };
/** p2p: this side consents to a direct (non-relayed) connection that can expose its network address. */
export type SparkMediaState = { video: boolean; audio: boolean; p2p: boolean };
export type SparkChatPayload = { text: string; client_id: string; at: string };
export type SparkTypingPayload = { typing: boolean };
export type SparkEndedPayload = { reason: string };

type SparkEventMap = {
  'spark:partner-joined': Record<string, never>;
  'spark:chat': SparkChatPayload;
  'spark:typing': SparkTypingPayload;
  'spark:ended': SparkEndedPayload;
  'spark:signal': SparkSignal;
  'spark:media': SparkMediaState;
};

export type SparkEventName = keyof SparkEventMap;

/** Delay before an unmount "leave" is sent, so a StrictMode remount can cancel it. */
const LEAVE_GRACE_MS = 50;
/** Retry a failed join (e.g. the pairing row is not visible yet) a few times. */
const JOIN_RETRY_MS = 1500;
const JOIN_MAX_RETRIES = 4;
/** Signals held while joining; an offer plus a burst of ICE candidates fits comfortably. */
const MAX_QUEUED_SIGNALS = 200;
let pendingLeave: ReturnType<typeof setTimeout> | null = null;

/**
 * The server drops spark:signal / spark:media until spark:join has resolved the pairing, and
 * resolving it is a database round trip. Anything sent before then used to be lost: a lost
 * offer meant the call never connected. So signals and the latest media state wait here until
 * the join is acknowledged.
 */
let joined = false;
let joining = false;
let joinRetries = 0;
let joinRetryTimer: ReturnType<typeof setTimeout> | null = null;
let queuedSignals: SparkSignal[] = [];
let queuedMedia: SparkMediaState | null = null;

function flushQueued(): void {
  if (queuedMedia) {
    websocket.emit('spark:media', queuedMedia);
    queuedMedia = null;
  }
  const signals = queuedSignals;
  queuedSignals = [];
  signals.forEach((s) => websocket.emit('spark:signal', s));
}

function resetJoin(): void {
  joined = false;
  joining = false;
  joinRetries = 0;
  if (joinRetryTimer) clearTimeout(joinRetryTimer);
  joinRetryTimer = null;
}

function requestJoin(): void {
  if (joining) return;
  if (!websocket.isConnected()) return; // onConnected() joins again
  joining = true;
  websocket
    .emitWithAck<{ ok?: boolean }>('spark:join', {})
    .then((res) => {
      joining = false;
      if (res?.ok) {
        joined = true;
        joinRetries = 0;
        flushQueued();
        return;
      }
      throw new Error('join refused');
    })
    .catch(() => {
      joining = false;
      if (joinRetries >= JOIN_MAX_RETRIES) return;
      joinRetries += 1;
      if (joinRetryTimer) clearTimeout(joinRetryTimer);
      joinRetryTimer = setTimeout(() => {
        joinRetryTimer = null;
        requestJoin();
      }, JOIN_RETRY_MS);
    });
}

websocket.onStatus((connected) => {
  // The pairing lives on the server socket: a reconnect must join again before sending.
  if (!connected) {
    joined = false;
    joining = false;
  }
});

export const sparkChannel = {
  join(): void {
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
    }
    joined = false;
    joinRetries = 0;
    requestJoin();
  },
  /** Leave now (explicit user action). */
  leave(reason: string): void {
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
    }
    resetJoin();
    queuedSignals = [];
    queuedMedia = null;
    websocket.emit('spark:leave', { reason });
  },
  /** Leave after a short grace period; cancelled by a following join (StrictMode remount). */
  scheduleLeave(reason: string): void {
    if (pendingLeave) clearTimeout(pendingLeave);
    pendingLeave = setTimeout(() => {
      pendingLeave = null;
      resetJoin();
      queuedSignals = [];
      queuedMedia = null;
      websocket.emit('spark:leave', { reason });
    }, LEAVE_GRACE_MS);
  },
  chat(text: string, clientId: string): void {
    websocket.emit('spark:chat', { text, client_id: clientId });
  },
  typing(typing: boolean): void {
    websocket.emit('spark:typing', { typing });
  },
  signal(kind: SparkSignalKind, data: unknown): void {
    if (joined) {
      websocket.emit('spark:signal', { kind, data });
      return;
    }
    if (queuedSignals.length < MAX_QUEUED_SIGNALS) queuedSignals.push({ kind, data });
  },
  media(state: SparkMediaState): void {
    if (joined) websocket.emit('spark:media', state);
    else queuedMedia = state; // only the latest state matters
  },
  on<E extends SparkEventName>(event: E, cb: (payload: SparkEventMap[E]) => void): () => void {
    return websocket.on<SparkEventMap[E]>(event, cb);
  },
  /** Fires with `true` whenever the socket (re)connects. */
  onConnected(cb: () => void): () => void {
    return websocket.onStatus((connected) => {
      if (connected) cb();
    });
  },
  isConnected(): boolean {
    return websocket.isConnected();
  },
};

/** Subscribe to one Spark event for the component lifetime; the latest callback is always used. */
export function useSparkEvent<E extends SparkEventName>(
  event: E,
  cb: (payload: SparkEventMap[E]) => void,
): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => sparkChannel.on(event, (p) => ref.current(p ?? ({} as SparkEventMap[E]))), [event]);
}
