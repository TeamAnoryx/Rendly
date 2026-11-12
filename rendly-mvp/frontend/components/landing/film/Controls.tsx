'use client';

import React, { useRef } from 'react';
import { DURATION, SHOTS, formatTime } from './timeline';

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
  fillRef: React.RefObject<HTMLSpanElement>;
  knobRef: React.RefObject<HTMLSpanElement>;
  timeRef: React.RefObject<HTMLSpanElement>;
  scrubRef: React.RefObject<HTMLDivElement>;
}

type ControlIcon = 'play' | 'pause' | 'expand' | 'shrink' | 'sound' | 'muted';

function Icon({ name }: { name: ControlIcon }) {
  const paths: Record<ControlIcon, React.ReactNode> = {
    play: <path d="M8 5.6v12.8c0 .7.8 1.1 1.4.7l9.6-6.4c.5-.3.5-1.1 0-1.4L9.4 4.9C8.8 4.5 8 4.9 8 5.6Z" fill="currentColor" stroke="none" />,
    pause: <path d="M9 6v12M15 6v12" strokeWidth="2.2" />,
    expand: <path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15" />,
    shrink: <path d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" />,
    sound: <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />,
    muted: <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3ZM16 9.5l5 5M21 9.5l-5 5" />,
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Minimal control row: play, timecode, chaptered scrubber, sound and fullscreen. */
export default function Controls(props: ControlsProps) {
  const { playing, muted, fullscreen, shot, onPlay, onMute, onFullscreen, onSeek, now, fillRef, knobRef, timeRef, scrubRef } =
    props;
  const dragging = useRef(false);

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(k * DURATION * 0.9999);
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

  return (
    <div className="pf2-controls">
      <button type="button" className="pf2-btn pf2-btn--play" onClick={onPlay} aria-label={playing ? 'Pause film' : 'Play film'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <span className="pf2-time" aria-hidden="true">
        <span ref={timeRef}>0:00</span>
        <span className="pf2-time-total"> / {formatTime(DURATION)}</span>
      </span>
      <div
        ref={scrubRef}
        className="pf2-scrub"
        role="slider"
        tabIndex={0}
        aria-label="Film position"
        aria-valuemin={0}
        aria-valuemax={DURATION}
        aria-valuetext={`${SHOTS[shot].label}, chapter ${shot + 1} of ${SHOTS.length}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekFromEvent(e);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className="pf2-track">
          <span ref={fillRef} className="pf2-fill" />
        </span>
        {SHOTS.map((s, i) => (
          <span
            key={s.id}
            className={`pf2-tick${i === shot ? ' is-on' : ''}${i < shot ? ' is-past' : ''}`}
            style={{ left: `${(s.start / DURATION) * 100}%`, width: `${((s.end - s.start) / DURATION) * 100}%` }}
          >
            <span className="pf2-tick-label">{s.label}</span>
          </span>
        ))}
        <span ref={knobRef} className="pf2-knob" />
      </div>
      <button
        type="button"
        className={`pf2-btn pf2-sound${muted ? '' : ' is-on'}`}
        onClick={onMute}
        aria-label={muted ? 'Turn sound on' : 'Mute sound'}
        aria-pressed={!muted}
      >
        <Icon name={muted ? 'muted' : 'sound'} />
      </button>
      <button
        type="button"
        className="pf2-btn pf2-btn--fs"
        onClick={onFullscreen}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      >
        <Icon name={fullscreen ? 'shrink' : 'expand'} />
      </button>
    </div>
  );
}
