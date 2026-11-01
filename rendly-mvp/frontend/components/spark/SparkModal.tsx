'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getSparkStatus,
  joinSparkQueue,
  leaveSparkQueue,
  type SparkIntent,
  type SparkMode,
  type SparkView,
} from '@/services/sparkApi';
import { DASHBOARD_INTENTS } from '@/hooks/useDashboard';
import { sparkChatUrl } from '@/lib/sparkRouting';

/** How often the waiting state is checked for a match. */
const POLL_INTERVAL_MS = 2000;

type Step = 'choose' | 'waiting' | 'error';

type SparkModalProps = {
  initialIntent: SparkIntent;
  onClose: () => void;
};

/**
 * Spark: pick text or video and an intent, wait in the queue, then open the 1:1 conversation
 * with the matched partner. For video, the chat page starts the call (initiator only).
 */
export default function SparkModal({ initialIntent, onClose }: SparkModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('choose');
  const [mode, setMode] = useState<SparkMode>('text');
  const [intent, setIntent] = useState<SparkIntent>(initialIntent);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while this modal has a queue entry that has not been cancelled or matched.
  const queuedRef = useRef(false);

  const handleMatched = useCallback(
    (view: Extract<SparkView, { status: 'matched' }>) => {
      queuedRef.current = false;
      router.push(sparkChatUrl(view));
      onClose();
    },
    [router, onClose]
  );

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const view = await joinSparkQueue(mode, intent);
      setStep('waiting');
      setElapsed(0);
      if (view.status === 'matched') {
        handleMatched(view);
        return;
      }
      queuedRef.current = view.status === 'waiting';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the match queue');
      setStep('error');
    } finally {
      setBusy(false);
    }
  }, [mode, intent, handleMatched]);

  // While waiting: poll for a match and count the seconds shown to the user.
  useEffect(() => {
    if (step !== 'waiting') return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const view = await getSparkStatus();
        if (cancelled) return;
        if (view.status === 'matched') {
          handleMatched(view);
        } else if (view.status === 'idle') {
          // The queue entry disappeared (for example it was cancelled elsewhere).
          queuedRef.current = false;
          setError('You are no longer in the queue. Start again.');
          setStep('error');
        }
      } catch {
        // Transient network error: keep polling.
      }
    }, POLL_INTERVAL_MS);
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [step, handleMatched]);

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      await leaveSparkQueue();
    } catch {
      // Closing anyway; the server drops stale entries after 10 minutes.
    } finally {
      queuedRef.current = false;
      setBusy(false);
      onClose();
    }
  }, [onClose]);

  // Closing the modal while waiting must not leave the user in the queue.
  useEffect(() => {
    return () => {
      if (queuedRef.current) leaveSparkQueue().catch(() => {});
    };
  }, []);

  return (
    <div className="spark-modal-backdrop" role="presentation">
      <div className="spark-modal" role="dialog" aria-modal="true" aria-labelledby="spark-title">
        <h2 id="spark-title" className="spark-modal-title">Spark a match</h2>

        {step === 'choose' && (
          <>
            <p className="spark-modal-label">How do you want to talk?</p>
            <div className="spark-modal-options" role="radiogroup" aria-label="Mode">
              {(['text', 'video'] as SparkMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={`spark-modal-option ${mode === m ? 'spark-modal-option--on' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'text' ? 'Text chat' : 'Video chat'}
                </button>
              ))}
            </div>

            <p className="spark-modal-label">Intent</p>
            <div className="spark-modal-options" role="radiogroup" aria-label="Intent">
              {DASHBOARD_INTENTS.map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={intent === i}
                  className={`spark-modal-option ${intent === i ? 'spark-modal-option--on' : ''}`}
                  onClick={() => setIntent(i as SparkIntent)}
                >
                  {i}
                </button>
              ))}
            </div>

            <div className="spark-modal-actions">
              <button type="button" className="spark-modal-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="spark-modal-btn spark-modal-btn--primary" onClick={start} disabled={busy}>
                {busy ? 'Joining…' : 'Find someone'}
              </button>
            </div>
          </>
        )}

        {step === 'waiting' && (
          <div className="spark-modal-waiting" role="status" aria-live="polite">
            <div className="spark-modal-spinner" aria-hidden />
            <p>
              Looking for someone for <strong>{intent}</strong> ({mode === 'text' ? 'text' : 'video'}).
            </p>
            <p className="spark-modal-elapsed">Waiting {elapsed}s</p>
            <div className="spark-modal-actions">
              <button type="button" className="spark-modal-btn" onClick={cancel} disabled={busy}>
                {busy ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <>
            <p className="spark-modal-error" role="alert">{error}</p>
            <div className="spark-modal-actions">
              <button type="button" className="spark-modal-btn" onClick={onClose}>Close</button>
              <button type="button" className="spark-modal-btn spark-modal-btn--primary" onClick={() => setStep('choose')}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
