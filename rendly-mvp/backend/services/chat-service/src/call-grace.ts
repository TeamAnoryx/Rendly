/**
 * 1:1 call presence: which whisper calls are live, and the disconnect grace for them.
 * When one side goes fully offline mid-call the other side hears `call:peer-paused`; if they
 * come back within the grace window it hears `call:peer-resumed`, otherwise `call:ended`
 * (status "dropped"). Pure apart from the emit callback and timers, so it is unit tested.
 */

import { GRACE_MS, GraceTimers } from "./grace";

export type CallEmit = (userId: string, event: string, payload: Record<string, unknown>) => void;

export type CallTracker = {
  accepted(conversationId: string, a: string, b: string): void;
  ended(conversationId: string): void;
  isActive(conversationId: string): boolean;
  /** The user's last socket dropped. */
  userOffline(userId: string): void;
  /** The user has a socket again. */
  userOnline(userId: string): void;
};

export function createCallTracker(emit: CallEmit, graceMs: number = GRACE_MS): CallTracker {
  /** conversationId -> the two people in the live call. */
  const calls = new Map<string, readonly [string, string]>();
  const grace = new GraceTimers(graceMs);
  const holdKey = (conversationId: string, userId: string) => `${conversationId}|${userId}`;
  const otherOf = (pair: readonly [string, string], userId: string) => (pair[0] === userId ? pair[1] : pair[0]);

  const ended = (conversationId: string) => {
    const pair = calls.get(conversationId);
    if (!pair) return;
    calls.delete(conversationId);
    for (const id of pair) grace.cancel(holdKey(conversationId, id));
  };

  return {
    accepted(conversationId, a, b) {
      if (a === b) return;
      calls.set(conversationId, [a, b]);
    },
    ended,
    isActive: (conversationId) => calls.has(conversationId),
    userOffline(userId) {
      for (const [conversationId, pair] of Array.from(calls)) {
        if (!pair.includes(userId)) continue;
        const other = otherOf(pair, userId);
        emit(other, "call:peer-paused", { conversation_id: conversationId, user_id: userId, reason: "away" });
        grace.hold(holdKey(conversationId, userId), () => {
          if (!calls.has(conversationId)) return;
          ended(conversationId);
          emit(other, "call:ended", { conversation_id: conversationId, call_log_id: null, status: "dropped" });
        });
      }
    },
    userOnline(userId) {
      for (const [conversationId, pair] of calls) {
        if (!pair.includes(userId)) continue;
        if (grace.cancel(holdKey(conversationId, userId))) {
          emit(otherOf(pair, userId), "call:peer-resumed", { conversation_id: conversationId, user_id: userId });
        }
      }
    },
  };
}
