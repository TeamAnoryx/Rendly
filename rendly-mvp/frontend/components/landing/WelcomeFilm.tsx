'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ProductFilm from './ProductFilm';
import { IconArrowRight } from './icons';
import './welcome-film.css';

/** The overlay's entrance (see .wf-inner in welcome-film.css); the film starts once it is fully in. */
const ENTER_MS = 1050;
/** "Get started" spinner: the page underneath settles (film paused, hero photos decoded) meanwhile. */
const HAND_OVER_MS = 2000;
/** Exit transition length; keep in step with .wf--leaving in welcome-film.css. */
const LEAVE_MS = 900;

/** entering: fading in, film held; playing: film with sound; handing: spinner; leaving: fading out. */
type Phase = 'entering' | 'playing' | 'handing' | 'leaving';

interface WelcomeFilmProps {
  /** Called once the overlay has faded and the page underneath is at the top. */
  onDone: () => void;
}

/** Loads and decodes the hero's photos so the hero entrance does not stutter on first paint. */
function warmHeroImages(): void {
  document.querySelectorAll<HTMLImageElement>('.ld-hero img').forEach((img) => {
    img.loading = 'eager';
    img.decode?.().catch(() => undefined);
  });
}

/**
 * Opens Home after the intro: the product film plays with sound once the overlay is fully in, and
 * the "Get started" pill below it mutes the film, settles the page for 2s, then fades the overlay
 * and hands over to the hero entrance at the top of the page.
 */
export default function WelcomeFilm({ onDone }: WelcomeFilmProps) {
  const [phase, setPhase] = useState<Phase>('entering');
  const timers = useRef<number[]>([]);

  // The page underneath stays at the top and does not scroll while the film is up.
  useEffect(() => {
    window.scrollTo(0, 0);
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const list = timers.current;
    list.push(window.setTimeout(() => setPhase((p) => (p === 'entering' ? 'playing' : p)), ENTER_MS));
    return () => {
      root.style.overflow = prev;
      list.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const getStarted = useCallback(() => {
    if (phase === 'handing' || phase === 'leaving') return;
    setPhase('handing');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    warmHeroImages();
    timers.current.push(
      window.setTimeout(() => setPhase('leaving'), HAND_OVER_MS),
      window.setTimeout(onDone, HAND_OVER_MS + LEAVE_MS)
    );
  }, [phase, onDone]);

  // Esc behaves like "Get started", so keyboard users are never stuck behind the film.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') getStarted();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getStarted]);

  const busy = phase === 'handing' || phase === 'leaving';

  return (
    <div
      className={`wf${phase === 'leaving' ? ' wf--leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Rendly in one flow"
    >
      <div className="wf-inner">
        <ProductFilm variant="player" sound={phase === 'playing'} hold={phase !== 'playing'} />
        <div className="wf-cta-slot">
          <button
            type="button"
            className={`wf-cta${busy ? ' is-busy' : ''}`}
            onClick={getStarted}
            disabled={busy}
            aria-busy={busy}
          >
            <span className="wf-cta-label">Get started</span>
            {busy ? <span className="wf-spinner" aria-hidden /> : <IconArrowRight size={16} className="wf-cta-arrow" />}
          </button>
        </div>
      </div>
    </div>
  );
}
