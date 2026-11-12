'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import IntroSplash, { INTRO_SEEN_KEY } from '@/components/intro/IntroSplash';

const loadLanding = () => import('@/components/landing/Landing');

/** Landing loads in its own chunk; the intro prefetches it while the film plays. */
const Landing = dynamic(loadLanding, {
  loading: () => <div className="min-h-[100dvh] bg-background" />,
});

type IntroState = 'pending' | 'show' | 'leaving' | 'hidden';

/** First visit (or `/?intro=1`) plays the brand intro; returning visitors land straight on the page. */
function shouldShowIntro(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('intro') === '1') return true;
    // Deep links such as /#spark (from /about, the footer) go straight to the section.
    if (window.location.hash) return false;
    return localStorage.getItem(INTRO_SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

export default function Page() {
  const [intro, setIntro] = useState<IntroState>('pending');

  useEffect(() => {
    const show = shouldShowIntro();
    setIntro(show ? 'show' : 'hidden');
    // Warm the landing chunk during the intro; if it fails, `dynamic` retries when it mounts.
    if (show) loadLanding().catch(() => undefined);
  }, []);

  return (
    <>
      {/* Mount the landing as the intro fades so its entrance animation is seen. */}
      {intro === 'leaving' || intro === 'hidden' ? <Landing /> : null}
      {intro === 'pending' ? <div className="fixed inset-0 z-[1000] bg-black" aria-hidden /> : null}
      {intro === 'show' || intro === 'leaving' ? (
        <IntroSplash onLeave={() => setIntro('leaving')} onDone={() => setIntro('hidden')} />
      ) : null}
    </>
  );
}
