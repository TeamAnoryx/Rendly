'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { shouldShowIntro, takeWelcomeFilm } from './welcomeFlow';

const Landing = dynamic(() => import('./Landing'), {
  loading: () => <div className="min-h-[100dvh] bg-background" />,
});
const WelcomeFilm = dynamic(() => import('./WelcomeFilm'), {
  loading: () => <div className="fixed inset-0 z-[1000] bg-black" aria-hidden />,
});

/** pending: deciding; intro: off to /intro; film: product film first; ready: the page itself. */
type HomeState = 'pending' | 'intro' | 'film' | 'ready';

/**
 * Home (`/`). First visits go to /intro; arriving from the intro's Proceed opens the product film
 * over the page, and "Get started" there plays the hero entrance.
 */
export default function HomeEntry() {
  const router = useRouter();
  const [state, setState] = useState<HomeState>('pending');
  // Decide once per mount: Strict Mode runs effects twice in dev, and the second run would find
  // the one-shot film flag already consumed and skip straight to the page.
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (shouldShowIntro()) {
      setState('intro');
      router.replace('/intro');
      return;
    }
    setState(takeWelcomeFilm() ? 'film' : 'ready');
  }, [router]);

  const onFilmDone = useCallback(() => setState('ready'), []);

  // The page is always rendered (so its content is in the server HTML for search engines);
  // while deciding, or on the way to /intro, a black cover sits on top of it.
  const covered = state === 'pending' || state === 'intro';
  return (
    <>
      <Landing heroPlay={state === 'ready'} />
      {covered ? <div className="fixed inset-0 z-[1000] bg-black" aria-hidden /> : null}
      {state === 'film' ? <WelcomeFilm onDone={onFilmDone} /> : null}
    </>
  );
}
