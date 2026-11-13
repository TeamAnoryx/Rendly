'use client';

/**
 * A tiny timeline renderer. Each animated element (<Fx>) registers an
 * animator `(t, layout) => Pose`; the film's single rAF loop calls paint(t)
 * and the registry writes transform / opacity / filter straight to the DOM,
 * with no React renders per frame. Shots (<Shot>) are registry groups that
 * are skipped entirely (display: none) outside their time window.
 */

import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';

export interface Layout {
  /** Virtual canvas size in px; the stage scales it to fit. */
  W: number;
  H: number;
  portrait: boolean;
}

export const LANDSCAPE: Layout = { W: 1600, H: 900, portrait: false };
export const PORTRAIT: Layout = { W: 900, H: 1200, portrait: true };

export interface Pose {
  x?: number;
  y?: number;
  z?: number;
  s?: number;
  sx?: number;
  sy?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  o?: number;
  blur?: number;
  bright?: number;
  clip?: string;
  text?: string;
  vars?: Record<string, string | number>;
  /** Pointer events on (for real links inside the film). */
  live?: boolean;
}

export type Animator = (t: number, L: Layout) => Pose;

interface Entry {
  el: HTMLElement;
  fx?: React.MutableRefObject<Animator | undefined>;
  anchor: boolean;
  range?: readonly [number, number];
  group?: Registry;
  /** Children of a shifted group see film time minus this. */
  shift: number;
  cache: Record<string, string>;
  hidden: boolean;
}

export class Registry {
  readonly entries = new Set<Entry>();
}

const Ctx = createContext<Registry | null>(null);

const n = (v: number) => (Math.abs(v) < 1e-4 ? 0 : Math.round(v * 100) / 100);

function write(e: Entry, key: string, value: string, set: (v: string) => void) {
  if (e.cache[key] === value) return;
  e.cache[key] = value;
  set(value);
}

function apply(e: Entry, p: Pose) {
  const st = e.el.style;
  const parts: string[] = [];
  if (e.anchor) parts.push('translate(-50%, -50%)');
  if (p.x || p.y || p.z) parts.push(`translate3d(${n(p.x ?? 0)}px, ${n(p.y ?? 0)}px, ${n(p.z ?? 0)}px)`);
  if (p.rx) parts.push(`rotateX(${n(p.rx)}deg)`);
  if (p.ry) parts.push(`rotateY(${n(p.ry)}deg)`);
  if (p.rz) parts.push(`rotate(${n(p.rz)}deg)`);
  const s = p.s ?? 1;
  const sx = s * (p.sx ?? 1);
  const sy = s * (p.sy ?? 1);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${Math.max(0.0001, Math.round(sx * 1000) / 1000)}, ${Math.max(0.0001, Math.round(sy * 1000) / 1000)})`);
  write(e, 'transform', parts.join(' ') || 'none', (v) => (st.transform = v));

  const o = Math.round((p.o ?? 1) * 1000) / 1000;
  write(e, 'opacity', String(o), (v) => (st.opacity = v));
  write(e, 'visibility', o <= 0.002 ? 'hidden' : 'visible', (v) => (st.visibility = v));

  const f: string[] = [];
  if (p.blur && p.blur > 0.15) f.push(`blur(${n(p.blur)}px)`);
  if (p.bright !== undefined && Math.abs(p.bright - 1) > 0.005) f.push(`brightness(${n(p.bright)})`);
  write(e, 'filter', f.join(' ') || 'none', (v) => (st.filter = v));

  if (p.clip !== undefined) write(e, 'clip', p.clip, (v) => (st.clipPath = v));
  if (p.text !== undefined) write(e, 'text', p.text, (v) => (e.el.textContent = v));
  if (p.live !== undefined) write(e, 'live', p.live ? 'auto' : 'none', (v) => (st.pointerEvents = v));
  if (p.vars) for (const k of Object.keys(p.vars)) write(e, k, String(p.vars[k]), (v) => st.setProperty(k, v));
}

/** Paints a registry (and its active groups) for film time t. */
export function paint(reg: Registry, t: number, L: Layout) {
  reg.entries.forEach((e) => {
    if (e.range) {
      const off = t < e.range[0] || t > e.range[1];
      if (off !== e.hidden) {
        e.hidden = off;
        e.el.style.display = off ? 'none' : '';
      }
      if (off) return;
    }
    if (e.fx?.current) apply(e, e.fx.current(t, L));
    if (e.group) paint(e.group, t - e.shift, L);
  });
}

export function RegistryProvider({ value, children }: { value: Registry; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useRegister(
  ref: React.RefObject<HTMLElement>,
  fx: Animator | undefined,
  anchor: boolean,
  range?: readonly [number, number],
  group?: Registry,
  shift = 0
) {
  const reg = useContext(Ctx);
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const r0 = range?.[0];
  const r1 = range?.[1];
  useLayoutEffect(() => {
    const el = ref.current;
    if (!reg || !el) return;
    const entry: Entry = {
      el,
      fx: fxRef,
      anchor,
      range: r0 === undefined || r1 === undefined ? undefined : [r0, r1],
      group,
      shift,
      cache: {},
      hidden: false,
    };
    reg.entries.add(entry);
    return () => {
      reg.entries.delete(entry);
    };
  }, [reg, ref, anchor, r0, r1, group, shift]);
}

type FxTag = 'div' | 'span' | 'a' | 'p';

export interface FxProps extends React.HTMLAttributes<HTMLElement> {
  fx?: Animator;
  as?: FxTag;
  /** Centre the element on its (x, y) — the default for absolutely placed layers. */
  anchor?: boolean;
  href?: string;
  children?: React.ReactNode;
}

/** An element whose transform/opacity/filter follow the film clock. */
export function Fx({ fx, as = 'div', anchor = true, className = '', children, ...rest }: FxProps) {
  const ref = useRef<HTMLElement>(null);
  useRegister(ref, fx, anchor);
  const Tag = as as React.ElementType;
  return (
    <Tag ref={ref} className={`${anchor ? 'fl-a ' : ''}${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Seconds added to every local time inside a shifted <Shot> (read by footage clips). */
export const ShiftCtx = createContext(0);

export interface ShotProps {
  /** Visible window in film seconds (include transition overlap). */
  range: readonly [number, number];
  /**
   * Re-time the children: they are authored on a local clock and run here
   * `shift` seconds later. The range stays in film seconds.
   */
  shift?: number;
  fx?: Animator;
  className?: string;
  children: React.ReactNode;
}

/** A layer that only exists (and only animates its children) inside `range`. */
export function Shot({ range, shift = 0, fx, className = '', children }: ShotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const groupRef = useRef<Registry>();
  if (!groupRef.current) groupRef.current = new Registry();
  const outer = useContext(ShiftCtx);
  useRegister(ref, fx, false, range, groupRef.current, shift);
  return (
    <div ref={ref} className={`fl-shot ${className}`}>
      <ShiftCtx.Provider value={outer + shift}>
        <RegistryProvider value={groupRef.current}>{children}</RegistryProvider>
      </ShiftCtx.Provider>
    </div>
  );
}
