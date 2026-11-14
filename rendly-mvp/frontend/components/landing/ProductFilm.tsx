'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Reveal from './Reveal';
import { FilmAudio } from './film/audio';
import Controls from './film/Controls';
import { ClipBank, ClipProvider } from './film/clips';
import { LANDSCAPE, PORTRAIT, Registry, RegistryProvider, Shot, paint, type Layout } from './film/engine';
import { ShotOnline, ShotWhy } from './film/shots-a';
import { ShotIntent } from './film/shots-b';
import { ShotMatching, ShotMeet } from './film/shots-c';
import { ShotSpark } from './film/shots-d';
import { ShotEnd, ShotReal } from './film/shots-e';
import { ShotOpen } from './film/shots-f';
import { ShotIntroducing, ShotWhyScatter } from './film/shots-g';
import { ShotWhispers } from './film/shots-h';
import { ShotEndReasons, ShotOffline, ShotOutThere } from './film/shots-i';
import { ShotHuddles } from './film/shots-j';
import { ShotDifferent } from './film/shots-k';
import { DURATION, OPEN_END, OPEN_SHIFT, SHIFT, SPARK_CUT, SPARK_CUT_AT, ease, formatTime, seg, shotAt } from './film/timeline';
import type { Animator } from './film/engine';
import './film/film.css';
import './film/film-shots.css';
import './film/film-shots-2.css';
import './film/film-shots-3.css';
import './film/film-shots-4.css';
import './film/film-shots-5.css';
import './film/film-shots-6.css';
import './film/film-shots-7.css';
import './product-film.css';

/** Where reduced-motion viewers rest: the finished end card. */
const STILL_T = DURATION - 1;

/** Huddles hands over to the sunset: the room drifts forward, blurs and dissolves. */
const huddlesOut: Animator = (t) => {
  const k = seg(t, 92.3, 93.35, ease.inCubic);
  return { s: 1 + 0.12 * k, blur: 14 * k, o: 1 - seg(t, 92.75, 93.35) };
};

/** Tracks prefers-reduced-motion, including live changes. */
function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return still;
}

/** True while the element is (nearly) on screen and the tab is visible. */
function useOnScreen(ref: React.RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return inView && tabVisible;
}

/** Narrow screens get a portrait (3:4) cut of the film. */
function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return portrait;
}

declare global {
  interface Window {
    __rendlyFilm?: {
      seek: (t: number) => void;
      pause: () => void;
      play: () => void;
      settle: () => Promise<void>;
      renderAudio: () => Promise<AudioBuffer>;
    };
  }
}

interface ProductFilmProps {
  /** `section`: the landing section with its header. `player`: the bare player (welcome overlay). */
  variant?: 'section' | 'player';
  /** When set, drives the sound from outside (true turns it on, false mutes); the button still works. */
  sound?: boolean;
  /** True keeps the film paused (e.g. while its overlay is still fading in, or handing over). */
  hold?: boolean;
}

/**
 * "From why to hello": a launch film of the real Rendly flow,
 * rendered live (DOM + canvas) from one clock so it scrubs, loops and stays
 * sharp at any size. Plays muted while on screen; sound is opt-in.
 */
export default function ProductFilm({ variant = 'section', sound, hold = false }: ProductFilmProps = {}) {
  const rootRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => new Registry(), []);
  const clips = useMemo(() => new ClipBank(), []);
  const audioRef = useRef<FilmAudio | null>(null);
  const tRef = useRef(0);
  const prevRef = useRef(0);
  const shotRef = useRef(0);

  const portrait = usePortrait();
  const layout: Layout = portrait ? PORTRAIT : LANDSCAPE;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const still = useReducedMotion();
  const onScreen = useOnScreen(rootRef);
  const [userPaused, setUserPaused] = useState(false);
  const [userPlayed, setUserPlayed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [shot, setShot] = useState(0);
  const playing = onScreen && !hold && !userPaused && (!still || userPlayed);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const render = useCallback(
    (t: number, seeked: boolean) => {
      const L = layoutRef.current;
      paint(registry, t, L);
      clips.sync(t, playingRef.current);
      const scrub = scrubRef.current;
      if (scrub) {
        scrub.style.setProperty('--t', t.toFixed(3));
        scrub.style.setProperty('--k', (t / DURATION).toFixed(5));
      }
      if (timeRef.current) {
        const label = formatTime(t);
        if (timeRef.current.textContent !== label) timeRef.current.textContent = label;
      }
      scrub?.setAttribute('aria-valuenow', String(Math.round(t)));
      const s = shotAt(t);
      if (s !== shotRef.current) {
        shotRef.current = s;
        setShot(s);
      }
      audioRef.current?.frame(prevRef.current, t, playingRef.current, seeked);
      prevRef.current = t;
    },
    [registry, clips]
  );

  const seek = useCallback(
    (t: number) => {
      tRef.current = Math.min(DURATION - 0.001, Math.max(0, t));
      render(tRef.current, true);
    },
    [render]
  );

  // Audio lives for the component's lifetime.
  useEffect(() => {
    const audio = new FilmAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
      clips.pauseAll();
    };
  }, [clips]);

  // Sound driven from outside (the welcome overlay): on when it opens, muted on "Get started".
  useEffect(() => {
    const audio = audioRef.current;
    if (sound === undefined || !audio) return;
    if (sound) {
      setMuted(false);
      audio
        .enable()
        .then(() => render(tRef.current, true))
        .catch(() => setMuted(true)); // no audio device / blocked: show the film as muted
    } else {
      setMuted(true);
      audio.disable();
    }
  }, [sound, render]);

  // Reduced motion rests on the finished end card until the viewer presses play.
  useEffect(() => {
    if (still && !userPlayed) seek(STILL_T);
  }, [still, userPlayed, seek]);

  // Fit the virtual canvas to the stage and size the canvases.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const L = layoutRef.current;
      if (canvasRef.current) canvasRef.current.style.transform = `scale(${(r.width / L.W).toFixed(5)})`;
      render(tRef.current, true);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [portrait, render]);

  // The clock: one rAF loop, only while playing.
  useEffect(() => {
    if (!playing) {
      render(tRef.current, true);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      tRef.current = (tRef.current + dt) % DURATION;
      render(tRef.current, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, render]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // Test hook for frame capture in development.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    window.__rendlyFilm = {
      seek,
      pause: () => setUserPaused(true),
      play: () => {
        setUserPaused(false);
        setUserPlayed(true);
      },
      settle: () => clips.settle(),
      renderAudio: () => new FilmAudio().renderOffline(),
    };
    return () => {
      delete window.__rendlyFilm;
    };
  }, [seek, clips]);

  const togglePlay = () => {
    if (playing) {
      setUserPaused(true);
      return;
    }
    setUserPaused(false);
    setUserPlayed(true);
    if (tRef.current >= DURATION - 0.6) seek(0);
  };

  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) {
      setMuted(false);
      await audio.enable();
      render(tRef.current, true);
    } else {
      setMuted(true);
      audio.disable();
    }
  };

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const stateCls = `pf2${playing ? ' is-playing' : ''}${portrait ? ' is-portrait' : ''}`;

  const player = (
    <>
          <div ref={shellRef} className={`pf2-shell${fullscreen ? ' is-fs' : ''}`}>
            <div className="pf2-frame">
              <div ref={stageRef} className="pf2-stage" aria-hidden="true">
                <div
                  ref={canvasRef}
                  className={`fl-root${portrait ? ' is-portrait' : ''}`}
                  style={{ width: layout.W, height: layout.H }}
                >
                  <RegistryProvider value={registry}>
                    <ClipProvider value={clips}>
                      <ShotOpen />
                      <Shot range={[OPEN_END - 0.1, SPARK_CUT_AT + OPEN_SHIFT + 0.45]} shift={OPEN_SHIFT}>
                      <Shot range={[9, 13.1]} shift={SHIFT.feeds}>
                        <ShotOnline />
                      </Shot>
                      <ShotWhyScatter />
                      <Shot range={[16.6, 20.75]} shift={SHIFT.why}>
                        <ShotWhy />
                      </Shot>
                      <ShotIntroducing />
                      <ShotIntent />
                      <ShotDifferent />
                      <Shot range={[45.3, 51.75]} shift={SHIFT.match}>
                        <ShotMatching />
                      </Shot>
                      <Shot range={[51.6, 64.1]} shift={SHIFT.meet}>
                        <ShotMeet />
                        <ShotSpark />
                      </Shot>
                      </Shot>
                      <Shot range={[SPARK_CUT_AT + OPEN_SHIFT - 0.1, DURATION]} shift={OPEN_SHIFT - SPARK_CUT}>
                      <ShotWhispers />
                      <Shot range={[76, 93.4]} fx={huddlesOut}>
                        <ShotHuddles />
                      </Shot>
                      <Shot range={[92.8, 95.6]} shift={SHIFT.offline}>
                        <ShotOffline />
                      </Shot>
                      <Shot range={[95.4, 102.95]} shift={SHIFT.real}>
                        <ShotReal />
                      </Shot>
                      <ShotOutThere />
                      <Shot range={[104.7, 120]} shift={SHIFT.end}>
                        <ShotEnd />
                      </Shot>
                      <ShotEndReasons />
                      </Shot>
                    </ClipProvider>
                  </RegistryProvider>
                </div>
              </div>
            </div>
            <Controls
              playing={playing}
              muted={muted}
              fullscreen={fullscreen}
              shot={shot}
              onPlay={togglePlay}
              onMute={toggleSound}
              onFullscreen={toggleFullscreen}
              onSeek={seek}
              now={() => tRef.current}
              timeRef={timeRef}
              scrubRef={scrubRef}
            />
          </div>
          <p className="sr-only">
            A film of Rendly that follows one person. Cities and feeds are full of people, but nobody
            is really meeting. Rendly is introduced: people tell it why they are here, from starting a run club to
            practising Spanish or meeting designers in Berlin. She types her own why, to meet people who care about
            the climate, and picks Friends. The film contrasts apps built around feeds, chats and profiles with
            Rendly, built around meeting. Rendly matches her with Jordan, who shares that why. They say hello on a
            Spark video call with live captions, keep talking in Whispers, then join a Huddle, a small live room of up
            to six, where they plan a Saturday meetup. They meet in person, and the film ends on the Rendly logo and
            the line: Know your why. Find your who.{' '}
            <a href="/auth/sign-up">Get started with Rendly</a>
          </p>
    </>
  );

  if (variant === 'player') {
    return (
      <div ref={rootRef as React.RefObject<HTMLDivElement>} className={`${stateCls} pf2-bare`}>
        <div className="pf2-player">{player}</div>
      </div>
    );
  }

  return (
    <section
      ref={rootRef}
      id="flow"
      className={`ld-section ld-section--bordered ${stateCls}`}
      aria-labelledby="pf2-title"
    >
      <div className="pf2-container">
        <header className="ld-section-head pf2-head">
          <Reveal as="p" className="ld-eyebrow">
            The film · 2:24
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="pf2-title">From why to hello, in one flow.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede">
            Set your why, get matched on it, meet face to face, then keep the conversation going.
          </Reveal>
        </header>

        <Reveal delay={160} className="pf2-player">
          {player}
        </Reveal>
      </div>
    </section>
  );
}
