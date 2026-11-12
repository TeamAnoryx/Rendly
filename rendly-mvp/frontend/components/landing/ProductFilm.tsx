'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Reveal from './Reveal';
import { FilmAudio } from './film/audio';
import Controls from './film/Controls';
import { LANDSCAPE, PORTRAIT, Registry, RegistryProvider, paint, type Layout } from './film/engine';
import { Ambient, ShotIntent, ShotMatching, ShotWhy } from './film/shots-open';
import { ShotCall, ShotEnd, ShotMeet, ShotWhispers } from './film/shots-close';
import { DURATION, formatTime, shotAt } from './film/timeline';
import './film/film.css';
import './product-film.css';

/** Where reduced-motion viewers rest: the finished end card. */
const STILL_T = 39;

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
    __rendlyFilm?: { seek: (t: number) => void; pause: () => void; play: () => void };
  }
}

/**
 * "From why to hello": a 40-second launch film of the real Rendly flow,
 * rendered live (DOM + canvas) from one clock so it scrubs, loops and stays
 * sharp at any size. Plays muted while on screen; sound is opt-in.
 */
export default function ProductFilm() {
  const rootRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => new Registry(), []);
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
  const playing = onScreen && !userPaused && (!still || userPlayed);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const render = useCallback(
    (t: number, seeked: boolean) => {
      const L = layoutRef.current;
      paint(registry, t, L);
      const k = t / DURATION;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${k.toFixed(4)})`;
      if (knobRef.current) knobRef.current.style.left = `${(k * 100).toFixed(3)}%`;
      if (timeRef.current) {
        const label = formatTime(t);
        if (timeRef.current.textContent !== label) timeRef.current.textContent = label;
      }
      scrubRef.current?.setAttribute('aria-valuenow', String(Math.round(t)));
      const s = shotAt(t);
      if (s !== shotRef.current) {
        shotRef.current = s;
        setShot(s);
      }
      audioRef.current?.frame(prevRef.current, t, playingRef.current, seeked);
      prevRef.current = t;
    },
    [registry]
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
    };
  }, []);

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
    };
    return () => {
      delete window.__rendlyFilm;
    };
  }, [seek]);

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

  return (
    <section
      ref={rootRef}
      id="flow"
      className={`ld-section ld-section--bordered pf2${playing ? ' is-playing' : ''}${portrait ? ' is-portrait' : ''}`}
      aria-labelledby="pf2-title"
    >
      <div className="pf2-container">
        <header className="ld-section-head pf2-head">
          <Reveal as="p" className="ld-eyebrow">
            The film · 0:40
          </Reveal>
          <Reveal as="h2" delay={60} className="ld-h2">
            <span id="pf2-title">From why to hello, in one flow.</span>
          </Reveal>
          <Reveal as="p" delay={120} className="ld-lede">
            Set your why, get matched on it, meet face to face, then keep the conversation going.
          </Reveal>
        </header>

        <Reveal delay={160} className="pf2-player">
          <div ref={shellRef} className={`pf2-shell${fullscreen ? ' is-fs' : ''}`}>
            <div className="pf2-frame">
              <div ref={stageRef} className="pf2-stage" aria-hidden="true">
                <div
                  ref={canvasRef}
                  className={`fl-root${portrait ? ' is-portrait' : ''}`}
                  style={{ width: layout.W, height: layout.H }}
                >
                  <RegistryProvider value={registry}>
                    <Ambient />
                    <ShotWhy />
                    <ShotIntent />
                    <ShotMatching />
                    <ShotMeet />
                    <ShotCall />
                    <ShotWhispers />
                    <ShotEnd />
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
              fillRef={fillRef}
              knobRef={knobRef}
              timeRef={timeRef}
              scrubRef={scrubRef}
            />
          </div>
          <p className="sr-only">
            A 40-second film of Rendly. Marco picks Co-founder as his intent and writes his why. Rendly matches him with
            Elena, who shares it. They see each other's profiles, meet on a video call with live captions, and keep
            talking in Whispers. It ends on the Rendly logo and the line: Find your who.{' '}
            <a href="/auth/sign-up">Get started with Rendly</a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
