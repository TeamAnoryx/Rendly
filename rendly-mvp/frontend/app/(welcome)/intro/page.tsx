'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import IntroSplash from '@/components/intro/IntroSplash';
import { requestWelcomeFilm } from '@/components/landing/welcomeFlow';

/** Proceed's spinner shows for at least this long, and never waits longer than the cap. */
const PROCEED_MIN_MS = 200;
const PROCEED_MAX_MS = 500;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Loads Home's code (page + welcome film) so it renders without a loading state. */
const preloadHome = () =>
  Promise.all([import('@/components/landing/Landing'), import('@/components/landing/WelcomeFilm')]).then(
    () => undefined,
    () => undefined // a failed preload just means Home loads its chunks itself
  );

/**
 * The brand intro film on its own page. Proceed preloads Home (spinner in the button), then hands
 * over to `/`, which opens with the product film: the Proceed click is the gesture that allows sound.
 */
export default function IntroPage() {
  const router = useRouter();

  useEffect(() => {
    router.prefetch('/');
  }, [router]);

  const proceed = useCallback(async () => {
    await Promise.all([wait(PROCEED_MIN_MS), Promise.race([preloadHome(), wait(PROCEED_MAX_MS)])]);
    requestWelcomeFilm();
    router.push('/');
  }, [router]);

  return (
    <div className="min-h-[100dvh] bg-black">
      <IntroSplash onProceed={proceed} onDone={() => undefined} />
    </div>
  );
}
