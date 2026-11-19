'use client';

/**
 * Real footage inside the film. Every <Clip> is a muted, inline <video> whose
 * position is slaved to the film clock: while the film plays it plays (and is
 * nudged back if it drifts), while paused or scrubbing it is seeked to the
 * exact frame. A clip's file is only requested once the playhead comes within
 * a few seconds of it, so the section costs nothing until it is watched.
 */

import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { ShiftCtx } from './engine';
import { withBasePath } from '@/lib/basePath';

const BASE = withBasePath('/film/clips/');
/** Start loading a clip this many seconds before it is needed. */
const PRELOAD = 4;
/**
 * A playing clip is steered back to the clock by nudging its playback rate;
 * only when it is further off than this (a jump, a stall) is it re-seeked.
 * Re-seeking on every small drift made busy scenes (five feeds at once) freeze:
 * each seek re-buffers, which drifts again, which seeks again.
 */
const DRIFT = 1.2;
/** Largest rate nudge used to catch up with the clock. */
const NUDGE = 0.12;

export type ClipName =
  | 'feed'
  | 'laptop'
  | 'laptop-pip'
  | 'call'
  | 'street'
  | 'meeting'
  | 'remote'
  | 'cafe'
  | 'mark'
  | 'city'
  | 'crowd'
  | 'crossing'
  | 'bridge'
  | 'sunset'
  | 'alone'
  | 'gate'
  | 'min'
  | 'ravi';

interface ClipEntry {
  el: HTMLVideoElement;
  name: ClipName;
  /** Film time the clip is on screen from / until. */
  a: number;
  b: number;
  /** Clip time shown at film time `a`. */
  offset: number;
  loop: boolean;
  /** A seek waiting for metadata. */
  pending: number | null;
}

export class ClipBank {
  readonly entries = new Set<ClipEntry>();

  /**
   * Called every painted frame by the film with authored time `t` and `rate`,
   * the authored seconds that pass per played second (the film's re-timing).
   */
  sync(t: number, playing: boolean, rate = 1) {
    this.entries.forEach((c) => syncClip(c, t, playing, rate));
  }

  /** Resolves once every on-screen clip shows its exact frame (frame export). */
  async settle(): Promise<void> {
    const waits: Promise<void>[] = [];
    this.entries.forEach((c) => {
      const el = c.el;
      if (el.closest('[style*="display: none"]') || !el.getAttribute('src')) return;
      waits.push(
        new Promise<void>((resolve) => {
          const done = () => resolve();
          const check = () => {
            if (el.readyState >= 2 && !el.seeking) done();
            else setTimeout(check, 10);
          };
          check();
          setTimeout(done, 5000);
        })
      );
    });
    await Promise.all(waits);
  }

  /** Pause everything (film unmounted, off screen). */
  pauseAll() {
    this.entries.forEach((c) => {
      if (!c.el.paused) c.el.pause();
    });
  }
}

function want(c: ClipEntry, t: number): number {
  const raw = c.offset + Math.max(0, t - c.a);
  const dur = c.el.duration;
  if (!Number.isFinite(dur) || dur <= 0) return raw;
  return c.loop ? raw % dur : Math.min(raw, dur - 0.05);
}

function seekTo(c: ClipEntry, v: number) {
  if (c.el.readyState < 1) {
    c.pending = v;
    return;
  }
  c.pending = null;
  try {
    c.el.currentTime = v;
  } catch {
    c.pending = v;
  }
}

function syncClip(c: ClipEntry, t: number, playing: boolean, rate: number) {
  const el = c.el;
  const near = t >= c.a - PRELOAD && t <= c.b + 0.5;
  if (near && !el.getAttribute('src')) {
    el.preload = 'auto';
    el.loop = c.loop;
    el.src = `${BASE}${c.name}.mp4`;
  }
  const active = t >= c.a && t <= c.b;
  if (!active) {
    if (!el.paused) el.pause();
    return;
  }
  const v = want(c, t);
  if (playing) {
    const dur = el.duration;
    let diff = v - el.currentTime;
    // A looping clip that has just wrapped is not behind, only on its next lap.
    if (c.loop && Number.isFinite(dur) && dur > 0 && Math.abs(diff) > dur / 2) diff -= Math.sign(diff) * dur;
    if (el.readyState < 1 || Math.abs(diff) > DRIFT) {
      seekTo(c, v);
    } else if (!el.seeking) {
      const target = Math.min(4, Math.max(0.25, rate * (1 + Math.max(-NUDGE, Math.min(NUDGE, diff * 0.5)))));
      if (Math.abs(el.playbackRate - target) > 0.01) el.playbackRate = target;
    }
    if (el.paused) void el.play().catch(() => undefined);
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - v) > 0.01) seekTo(c, v);
  }
}

const Ctx = createContext<ClipBank | null>(null);

export function ClipProvider({ value, children }: { value: ClipBank; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface ClipProps {
  name: ClipName;
  /** Film window in which this clip is visible. */
  range: readonly [number, number];
  /** Clip time at the start of the window. */
  offset?: number;
  loop?: boolean;
  className?: string;
  /** object-position for the cover fit. */
  focus?: string;
}

/** A footage layer filling its parent. Decorative: hidden from assistive tech. */
export function Clip({ name, range, offset = 0, loop = false, className = '', focus }: ClipProps) {
  const bank = useContext(Ctx);
  const ref = useRef<HTMLVideoElement>(null);
  const shift = useContext(ShiftCtx);
  const a = range[0] + shift;
  const b = range[1] + shift;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!bank || !el) return;
    el.muted = true;
    el.defaultMuted = true;
    const entry: ClipEntry = { el, name, a, b, offset, loop, pending: null };
    const onMeta = () => {
      if (entry.pending === null) return;
      const v = entry.pending;
      entry.pending = null;
      try {
        el.currentTime = v;
      } catch {
        /* the next frame retries */
      }
    };
    el.addEventListener('loadedmetadata', onMeta);
    bank.entries.add(entry);
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.pause();
      bank.entries.delete(entry);
    };
  }, [bank, name, a, b, offset, loop]);

  return (
    <video
      ref={ref}
      className={`fl-clip ${className}`}
      poster={`${BASE}${name}.jpg`}
      muted
      playsInline
      preload="none"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
      style={focus ? { objectPosition: focus } : undefined}
    />
  );
}
