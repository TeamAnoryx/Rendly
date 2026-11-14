'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { RendlyMark } from '@/components/brand/Brand';
import PovOrbit from '@/components/motion/PovOrbit';
import {
  IconArrowRight,
  IconHome,
  IconHuddles,
  IconMic,
  IconPhoneOff,
  IconSearch,
  IconSpark,
  IconUser,
  IconVideo,
  IconWhispers,
} from './icons';
import { HERO_PHOTOS } from './photos';
import './hero-orbit.css';

const RAIL = [
  { label: 'Home', Icon: IconHome },
  { label: 'Spark', Icon: IconSpark, active: true },
  { label: 'Whispers', Icon: IconWhispers },
  { label: 'Huddles', Icon: IconHuddles },
  { label: 'Profile', Icon: IconUser },
];

const INTENTS = ['Co-founder', 'Mentor', 'Hiring', 'Collaborating', 'Side project'];
const SHARED = ['Co-founder', 'Climate tech', 'B2B SaaS'];

/** Scroll progress over the first ~420px eases the mock from tilted to flat. */
function useScrollTilt(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--tilt', '0');
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / 420));
      el.style.setProperty('--tilt', (1 - p).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

function SparkMock() {
  return (
    <div className="ld-app" aria-hidden="true">
      <div className="ld-app-chrome">
        <span className="ld-app-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="ld-app-title">Rendly — Spark</span>
        <span className="ld-app-chrome-spacer" />
      </div>

      <div className="ld-app-body">
        <aside className="ld-app-rail">
          <div className="ld-app-rail-logo">
            <RendlyMark className="h-[16px] w-auto" />
          </div>
          {RAIL.map(({ label, Icon, active }) => (
            <div key={label} className={`ld-app-rail-item${active ? ' is-active' : ''}`}>
              <Icon size={15} />
              <span>{label}</span>
            </div>
          ))}
          <div className="ld-app-rail-me">
            <span className="ld-avatar ld-avatar--xs">YO</span>
            <span>You</span>
          </div>
        </aside>

        <div className="ld-app-main">
          <div className="ld-app-top">
            <div>
              <div className="ld-app-h">Spark</div>
              <div className="ld-app-sub">People who share your why, right now.</div>
            </div>
            <div className="ld-app-top-right">
              <span className="ld-app-search">
                <IconSearch size={13} />
                <span>Search</span>
                <span className="rd-kbd">/</span>
              </span>
              <span className="ld-pill-status">
                <span className="ld-live-dot" />
                Matching
              </span>
            </div>
          </div>

          <div className="ld-app-chips">
            {INTENTS.map((i, idx) => (
              <span key={i} className={`ld-chip${idx === 0 ? ' is-on' : ''}`}>
                {i}
              </span>
            ))}
          </div>

          <div className="ld-spark-grid">
            <div className="ld-match">
              <div className="ld-match-head">
                <span className="ld-avatar ld-avatar--lg">
                  MR
                  <span className="ld-online" />
                </span>
                <div className="ld-match-id">
                  <div className="ld-match-name">Maya R.</div>
                  <div className="ld-match-role">Product designer · Lisbon</div>
                </div>
              </div>
              <p className="ld-match-why">
                <span className="ld-match-why-label">Her why</span>
                Looking for a technical co-founder to build climate software for small businesses.
              </p>
              <div className="ld-match-score">
                <div className="ld-match-score-row">
                  <span className="ld-match-score-num rd-spectrum-text">92%</span>
                  <span className="ld-match-score-label">intent match</span>
                </div>
                <div className="ld-meter">
                  <span style={{ width: '92%' }} />
                </div>
              </div>
              <div className="ld-match-tags">
                {SHARED.map((s) => (
                  <span key={s} className="ld-tag">
                    {s}
                  </span>
                ))}
              </div>
              <div className="ld-match-actions">
                <span className="ld-fake-btn ld-fake-btn--primary">
                  <IconVideo size={14} />
                  Connect
                </span>
                <span className="ld-fake-btn">Skip</span>
              </div>
            </div>

            <div className="ld-stage">
              <div className="ld-tile ld-tile--main">
                <span className="rd-badge rd-badge--live ld-tile-badge">Live</span>
                <span className="ld-tile-timer rd-mono">00:42</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="ho-feed" src={HERO_PHOTOS.live.src} alt="" decoding="async" style={{ objectPosition: HERO_PHOTOS.live.focus }} />
                <span className="ho-feed-shade" />
                <span className="ld-tile-name">{HERO_PHOTOS.live.name}</span>
                <div className="ld-tile ld-tile--pip">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="ho-feed" src={HERO_PHOTOS.you.src} alt="" decoding="async" style={{ objectPosition: HERO_PHOTOS.you.focus }} />
                  <span className="ld-tile-name ld-tile-name--sm">You</span>
                </div>
              </div>
              <div className="ld-controls">
                <span className="ld-ctrl">
                  <IconMic size={15} />
                </span>
                <span className="ld-ctrl">
                  <IconVideo size={15} />
                </span>
                <span className="ld-ctrl">
                  <IconWhispers size={15} />
                </span>
                <span className="ld-ctrl ld-ctrl--end">
                  <IconPhoneOff size={15} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hero entrance, one beat at a time: (1) the pill, (2) the headline, (3) the copy and buttons
 * together with the photo cards flowing in from the top right, then the product mock.
 */
/** Each headline line takes LINE_MS (see .ho-line); the second follows the first after a 0.5s pause. */
const LINE_MS = 1300;
const LINE_PAUSE_MS = 500;
const TITLE_MS = 700;
const TITLE2_MS = TITLE_MS + LINE_MS + LINE_PAUSE_MS;
const STEP_MS = {
  pill: 100,
  title: TITLE_MS,
  title2: TITLE2_MS,
  copy: TITLE2_MS + LINE_MS - 300,
  mock: TITLE2_MS + LINE_MS + 400,
} as const;

interface HeroProps {
  /** False holds every entrance (hidden) until the welcome film hands over; true plays it. */
  play?: boolean;
}

export default function Hero({ play = true }: HeroProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  useScrollTilt(stageRef);

  return (
    <section className={`ld-hero${play ? '' : ' ld-hero--hold'}`} aria-labelledby="ld-hero-title">
      <PovOrbit className="ho-orbit" burst={play} burstDelayMs={STEP_MS.copy} />
      <div className="ld-container ld-hero-copy">
        <a href="#product" className="ld-pill ld-enter ld-hero-step" style={{ animationDelay: `${STEP_MS.pill}ms` }}>
          <span className="ld-pill-strong">Introducing Rendly</span>
          <span className="ld-pill-sep" aria-hidden="true" />
          <span className="ld-pill-muted">Intent-based networking</span>
          <IconArrowRight size={13} className="ld-pill-arrow" />
        </a>

        <h1 id="ld-hero-title" className="ld-hero-title">
          <span className="ho-line" style={{ animationDelay: `${STEP_MS.title}ms` }}>
            Know your why.
          </span>
          <span className="ho-line" style={{ animationDelay: `${STEP_MS.title2}ms` }}>
            Find your <span className="rd-spectrum-text ld-hero-accent">who.</span>
          </span>
        </h1>

        <p className="ld-hero-sub ld-enter ld-hero-step" style={{ animationDelay: `${STEP_MS.copy}ms` }}>
          Rendly matches you with people who want the same thing you do, whether that is a co-founder, a mentor or
          your next hire, then puts you face to face in seconds.
        </p>

        <div className="ld-hero-ctas ld-enter ld-hero-step" style={{ animationDelay: `${STEP_MS.copy}ms` }}>
          <Link href="/auth/sign-up" className="rd-btn rd-btn--primary rd-btn--lg">
            Get started
            <IconArrowRight size={15} className="rd-btn-arrow" />
          </Link>
          <Link href="/login" className="rd-btn rd-btn--lg">
            Log in
          </Link>
        </div>
      </div>

      <div className="ld-container ld-hero-visual ld-enter ld-enter--slow" style={{ animationDelay: `${STEP_MS.mock}ms` }}>
        <div className="ld-hero-light" aria-hidden="true" />
        <div ref={stageRef} className="ld-hero-stage ho-stage">
          <div className="ld-frame">
            <SparkMock />
          </div>
        </div>
        <p className="sr-only">
          Preview of the Rendly app: the Spark screen showing intent filters, a 92 percent intent match card with a
          Connect button, and a live video call.
        </p>
      </div>
    </section>
  );
}
