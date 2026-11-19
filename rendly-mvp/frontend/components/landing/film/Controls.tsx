'use client';

import React, { useRef, useState } from 'react';
import { CHAPTERS as SHOTS, DURATION, formatTime } from './timeline';

export interface ControlsProps {
  playing: boolean;
  muted: boolean;
  fullscreen: boolean;
  shot: number;
  onPlay: () => void;
  onMute: () => void;
  onFullscreen: () => void;
  onSeek: (t: number) => void;
  /** Read the current film time (for keyboard steps). */
  now: () => number;
  timeRef: React.RefObject<HTMLSpanElement>;
  /** The film writes `--t` (seconds) and `--k` (0..1) on this element every frame. */
  scrubRef: React.RefObject<HTMLDivElement>;
}

/** Play and pause are one shape that morphs (two clip-path halves). */
function PlayPause({ playing }: { playing: boolean }) {
  return <span className={`pf3-pp${playing ? ' is-playing' : ''}`} aria-hidden="true" />;
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg className={`pf3-sound${muted ? ' is-muted' : ''}`} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path className="pf3-sound-body" d="M4 9.5h3.2L12 5.5v13l-4.8-4H4Z" />
      <path className="pf3-sound-w1" d="M15.4 9.2a4 4 0 0 1 0 5.6" />
      <path className="pf3-sound-w2" d="M17.9 6.6a7.6 7.6 0 0 1 0 10.8" />
      <path className="pf3-sound-x" d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg className={`pf3-fs${active ? ' is-active' : ''}`} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path className="pf3-fs-tl" d="M4 9V4h5" />
      <path className="pf3-fs-tr" d="M15 4h5v5" />
      <path className="pf3-fs-bl" d="M4 15v5h5" />
      <path className="pf3-fs-br" d="M20 15v5h-5" />
    </svg>
  );
}

/**
 * The player dock: a glass bar with a morphing play button, timecode, a
 * segmented chapter scrubber (one pill per chapter, filling white as it
 * plays), sound and full screen.
 */
export default function Controls(props: ControlsProps) {
  const { playing, muted, fullscreen, shot, onPlay, onMute, onFullscreen, onSeek, now, timeRef, scrubRef } = props;
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);

  const timeFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * DURATION * 0.9999;
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 2;
    const map: Record<string, number | undefined> = {
      ArrowRight: now() + step,
      ArrowUp: now() + step,
      ArrowLeft: now() - step,
      ArrowDown: now() - step,
      Home: 0,
      End: DURATION - 0.01,
      PageUp: SHOTS[Math.min(SHOTS.length - 1, shot + 1)].start,
      PageDown: SHOTS[Math.max(0, shot - 1)].start,
    };
    const v = map[e.key];
    if (v === undefined) return;
    e.preventDefault();
    onSeek(Math.min(DURATION - 0.01, Math.max(0, v)));
  };

  const label = SHOTS[hover ?? shot];

  return (
    <div className="pf3-dock">
      <button
        type="button"
        className="pf3-btn pf3-btn--play"
        onClick={onPlay}
        aria-label={playing ? 'Pause film' : 'Play film'}
      >
        <PlayPause playing={playing} />
      </button>

      <div className="pf3-mid">
        <div className="pf3-meta" aria-hidden="true">
          <span className="pf3-chapter" key={`${hover ?? 'p'}-${label.id}`}>
            <span className="pf3-chapter-num">{String((hover ?? shot) + 1).padStart(2, '0')}</span>
            {label.label}
          </span>
          <span className="pf3-time">
            <span ref={timeRef}>0:00</span>
            <span className="pf3-time-total"> / {formatTime(DURATION)}</span>
          </span>
        </div>
        <div
          ref={scrubRef}
          className="pf3-scrub"
          role="slider"
          tabIndex={0}
          aria-label="Film position"
          aria-valuemin={0}
          aria-valuemax={DURATION}
          aria-valuenow={0}
          aria-valuetext={`${SHOTS[shot].label}, chapter ${shot + 1} of ${SHOTS.length}`}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onSeek(timeFromEvent(e));
          }}
          onPointerMove={(e) => {
            const t = timeFromEvent(e);
            const i = SHOTS.findIndex((s) => t >= s.start && t < s.end);
            setHover(i < 0 ? SHOTS.length - 1 : i);
            if (dragging.current) onSeek(t);
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setHover(null);
          }}
        >
          {SHOTS.map((s, i) => (
            <span
              key={s.id}
              className={`pf3-seg${i === shot ? ' is-on' : ''}${i === hover ? ' is-hover' : ''}`}
              style={{ flexGrow: s.end - s.start, ['--s' as string]: s.start, ['--d' as string]: s.end - s.start }}
            >
              <span className="pf3-seg-fill" />
              <span className="pf3-seg-tip">{s.label}</span>
            </span>
          ))}
          <span className="pf3-knob" />
        </div>
      </div>

      <button
        type="button"
        className={`pf3-btn${muted ? '' : ' is-on'}`}
        onClick={onMute}
        aria-label={muted ? 'Turn sound on' : 'Mute sound'}
        aria-pressed={!muted}
      >
        <SoundIcon muted={muted} />
      </button>
      <button
        type="button"
        className="pf3-btn pf3-btn--fs"
        onClick={onFullscreen}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      >
        <FullscreenIcon active={fullscreen} />
      </button>
    </div>
  );
}
