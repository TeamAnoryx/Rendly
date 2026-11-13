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
let pendingLeave: ReturnType<typeof setTimeout> | null = null;

export const sparkChannel = {
  join(): void {
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
    }
    websocket.emit('spark:join');
  },
  /** Leave now (explicit user action). */
  leave(reason: string): void {
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
    }
    websocket.emit('spark:leave', { reason });
  },
  /** Leave after a short grace period; cancelled by a following join (StrictMode remount). */
  scheduleLeave(reason: string): void {
    if (pendingLeave) clearTimeout(pendingLeave);
    pendingLeave = setTimeout(() => {
      pendingLeave = null;
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
    websocket.emit('spark:signal', { kind, data });
  },
  media(state: SparkMediaState): void {
    websocket.emit('spark:media', state);
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
