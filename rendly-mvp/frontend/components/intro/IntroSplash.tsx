'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import './intro.css';

export const INTRO_SEEN_KEY = 'rendly:intro-seen';

/** Delays (ms) after the film ends, for each reveal step. */
const STEP_DELAYS = { label: 700, symbol: 1250, word: 1900, proceed: 3000 } as const;
/** The film is 5s; if it stalls (slow network, decoding), finish anyway. */
const FILM_TIMEOUT_MS = 8000;
const LEAVE_MS = 700;

type Step = 0 | 1 | 2 | 3 | 4 | 5; // 0 film, 1 revealed, 2 label, 3 symbol, 4 word, 5 proceed

interface IntroSplashProps {
  /** Called when the exit transition starts (page can mount what sits underneath). */
  onLeave?: () => void;
  /** Called once the exit transition has finished. */
  onDone: () => void;
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // Private mode / blocked storage: the intro simply shows again next visit.
  }
}

export default function IntroSplash({ onLeave, onDone }: IntroSplashProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const proceedRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const ended = useRef(false);
  const [step, setStep] = useState<Step>(0);
  const [fallback, setFallback] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const runReveal = useCallback((instant: boolean) => {
    if (ended.current) return;
    ended.current = true;
    clearTimers();
    if (instant) {
      setStep(5);
      return;
    }
    setStep(1);
    timers.current.push(
      window.setTimeout(() => setStep(2), STEP_DELAYS.label),
      window.setTimeout(() => setStep(3), STEP_DELAYS.symbol),
      window.setTimeout(() => setStep(4), STEP_DELAYS.word),
      window.setTimeout(() => setStep(5), STEP_DELAYS.proceed)
    );
  }, []);

  // Start the film, or go straight to the final composition when motion is reduced / playback fails.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setFallback(true);
      runReveal(true);
      return clearTimers;
    }
    const v = videoRef.current;
    if (v) {
      v.muted = true;
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          setFallback(true);
          runReveal(false);
        });
      }
    }
    const guard = window.setTimeout(() => runReveal(false), FILM_TIMEOUT_MS);
    return () => {
      window.clearTimeout(guard);
      clearTimers();
    };
  }, [runReveal]);

  // Lock page scroll while the intro is on screen.
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (step === 5) proceedRef.current?.focus({ preventScroll: true });
  }, [step]);

  const leave = useCallback(() => {
    if (leaving) return;
    markIntroSeen();
    setLeaving(true);
    onLeave?.();
    window.setTimeout(onDone, LEAVE_MS);
  }, [leaving, onLeave, onDone]);

  const skip = useCallback(() => {
    const v = videoRef.current;
    if (v && !ended.current) {
      v.pause();
      try {
        v.currentTime = Math.max(0, (v.duration || 5) - 0.05);
      } catch {
        setFallback(true);
      }
    }
    if (!ended.current) {
      ended.current = true;
      clearTimers();
      setStep(5);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (step < 5) skip();
        else leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, skip, leave]);

  const cls = [
    'intro',
    step >= 1 && 'intro--revealed',
    step >= 2 && 'intro--step-label',
    step >= 3 && 'intro--step-symbol',
    step >= 4 && 'intro--step-word',
    step >= 5 && 'intro--step-proceed',
    fallback && 'intro--fallback',
    leaving && 'intro--leaving',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="dialog" aria-modal="true" aria-label="Welcome to Rendly">
      <div className="intro-stage">
        <video
          ref={videoRef}
          className="intro-video"
          src="/video/rendly-intro-dark.mp4"
          muted
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          onEnded={() => runReveal(false)}
          onError={() => {
            setFallback(true);
            runReveal(false);
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="intro-still" src="/brand/rendly-wordmark-white.png" alt="" aria-hidden draggable={false} />
      </div>

      <div className="intro-after">
        <div className="intro-proceed-slot">
          <button
            ref={proceedRef}
            type="button"
            className="intro-proceed"
            onClick={leave}
            tabIndex={step >= 5 ? 0 : -1}
            aria-hidden={step < 5}
          >
            Proceed
            <ArrowRight />
          </button>
        </div>

        <div className="intro-credit" aria-label="A product of Anoryx">
          <span className="intro-credit-label">A product of</span>
          <span className="intro-anoryx">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="intro-anoryx-symbol" src="/images/anoryx-symbol-white.png" alt="" draggable={false} />
            <span className="intro-anoryx-divider" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="intro-anoryx-word" src="/images/anoryx-wordmark-white.png" alt="Anoryx" draggable={false} />
          </span>
        </div>
      </div>

      {step < 5 && !leaving ? (
        <button type="button" className="intro-skip" onClick={skip}>
          Skip intro
        </button>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {step >= 5 ? 'Rendly, a product of Anoryx. Press Proceed to continue.' : ''}
      </span>
    </div>
  );
}
