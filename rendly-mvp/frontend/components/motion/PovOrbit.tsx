'use client';

import React, { useEffect, useRef } from 'react';
import './pov-orbit.css';

/** A card image: a path, or a path plus an object-position focal point for the crop. */
export type PovImage = string | { src: string; position?: string };

/** The seven POV photos; the ring holds them twice so a repeat is always half a turn away. */
const PHOTOS: PovImage[] = [
  { src: '/images/pov21.jpg', position: '60% 40%' },
  { src: '/images/pov22.jpg', position: '52% 35%' },
  { src: '/images/pov23.jpg', position: '55% 35%' },
  { src: '/images/pov24.jpg', position: '52% 40%' },
  { src: '/images/pov26.jpg', position: '55% 45%' },
  { src: '/images/pov28.jpeg', position: '70% 40%' },
  { src: '/images/pov29.jpg', position: '55% 50%' },
];

export const DEFAULT_POV_IMAGES: PovImage[] = [...PHOTOS, ...PHOTOS];

interface PovOrbitProps {
  images?: PovImage[];
  className?: string;
  /** Seconds for one card to travel one slot along the arc. */
  speed?: number;
  /** Cards the arc is laid out for (the card size shrinks so at least 5 fit a short box). */
  visible?: number;
  /** Follow the pointer with a few pixels of parallax. */
  parallax?: boolean;
  /** Turning true starts an entrance burst: the cards sweep down fast, then ease to their cruise speed. */
  burst?: boolean;
  /** Delay before the burst starts, in ms (to line up with a CSS entrance). */
  burstDelayMs?: number;
}

/** Entrance burst: peak speed multiple and how long it takes to ease back to 1x. */
const BURST_BOOST = 7;
const BURST_MS = 2600;

const ASPECT = 4 / 3;
/** Vertical centre spacing between neighbouring cards, as a share of card height (each lower card
 * covers the bottom ~38% of the one above, as in the reference). */
const SPACING = 0.62;
/** Rightward drift per slot squared, as a share of card width: slot 2 is clipped by the right edge,
 * slot 3 mostly hidden past it (the arc of a wheel whose hub sits off to the right). */
const DRIFT = 0.12;
/** Spoke tilt per slot, in degrees (right side down above the middle, up below it). */
const TILT_DEG = 7;
/** Free space right of the middle card, as a share of card width. */
const RIGHT_SPACE = 0.5;
/** Minimum share of box height kept clear above and below the arc. */
const GAP_RATIO = 0.1;
/** Share of the edge fade spent on transparency (the rest darkens into the canvas). */
const FADE_ALPHA = 0.35;
const MAX_DT = 64;

const readNum = (cs: CSSStyleDeclaration, name: string, fallback: number) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

/**
 * Landscape photo cards set like spokes on the left arc of a wheel whose hub sits to the right of
 * the box: the middle card is flat with clear space to its right, cards above tip
 * right side down, cards below right side up, and both drift right into the box edge. Cards travel
 * slowly downward at a constant rate; each lower card is stacked over the one above it, so nothing
 * swaps depth on screen (the wrap happens half a ring away, out of sight).
 *
 * Every frame writes only `transform`, `opacity` and `z-index` (no layout).
 * Knobs (CSS custom properties on the root): `--po-w` card width, `--po-cy` vertical centre (0-1),
 * `--po-gap` px kept clear above and below (at least 10% of the box). Decorative: aria-hidden,
 * paused off-screen and in hidden tabs, static under reduced motion.
 */
export default function PovOrbit({
  images = DEFAULT_POV_IMAGES,
  className = '',
  speed = 11,
  visible = 7,
  parallax = false,
  burst = false,
  burstDelayMs = 0,
}: PovOrbitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** performance.now() at which the current burst starts; 0 when none is running. */
  const burstAtRef = useRef(0);

  useEffect(() => {
    burstAtRef.current = burst ? performance.now() + burstDelayMs : 0;
  }, [burst, burstDelayMs]);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const shadesRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = cardsRef.current.slice(0, images.length);
    const shades = shadesRef.current.slice(0, images.length);
    const n = cards.length;
    if (!n || cards.some((c) => !c)) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const half = n / 2;
    const reach = Math.max(1, (visible - 1) / 2);

    let geo = { w: 0, h: 0, midX: 0, cy: 0, boxH: 0, gap: 0 };
    let onScreen = true;
    let frame = 0;
    let last = 0;
    let phase = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const measure = () => {
      const cs = getComputedStyle(root);
      const boxW = root.clientWidth;
      const boxH = root.clientHeight;
      const gap = Math.max(readNum(cs, '--po-gap', 0), boxH * GAP_RATIO);
      const cy = boxH * Math.min(0.9, Math.max(0.1, readNum(cs, '--po-cy', 0.5)));
      const room = Math.min(cy, boxH - cy) - gap;
      // Largest card whose outermost slot (visible/2 away) still has its centre inside the clear band;
      // that end card is the one darkening out.
      const fitH = room > 0 ? room / (reach * SPACING) : 72;
      const w = Math.max(96, Math.min(readNum(cs, '--po-w', 250), fitH * ASPECT));
      const h = w / ASPECT;
      // The middle card's right edge sits RIGHT_SPACE card widths inside the box.
      const midX = boxW - w * RIGHT_SPACE - w / 2;
      geo = { w, h, midX, cy, boxH, gap };
      root.style.setProperty('--po-cw', `${w.toFixed(2)}px`);
    };

    const paint = () => {
      const { w, h, midX, cy, boxH, gap } = geo;
      for (let i = 0; i < n; i++) {
        // Slot offset from the middle, in [-half, half); positive = above.
        let s = (((i + phase) % n) + n) % n;
        if (s >= half) s -= n;
        const card = cards[i] as HTMLDivElement;
        if (Math.abs(s) > reach + 1.5) {
          if (card.style.opacity !== '0') card.style.opacity = '0';
          continue;
        }
        // Constant vertical speed; the rightward drift grows with the square of the distance.
        const xc = midX + DRIFT * w * s * s;
        const yc = cy - s * SPACING * h;
        const t = Math.min(1, Math.abs(s) / reach);
        const scale = 1 - 0.1 * t;
        const tilt = s * TILT_DEG;
        // Distance of the card centre inside the clear band. Cards stay full until their centre is
        // 0.4h from the band, darken into the canvas, and only turn transparent at the very end.
        const inside = Math.min(yc, boxH - yc) - gap;
        const fade = Math.max(0, Math.min(1, (h * 0.4 - inside) / (h * 0.6)));
        const opacity = Math.max(0, Math.min(1, (1 - fade) / FADE_ALPHA));
        card.style.transform =
          `translate3d(${(xc - w / 2 + pointer.x).toFixed(2)}px, ${(yc - h / 2 + pointer.y).toFixed(2)}px, 0) ` +
          `perspective(1400px) rotate(${tilt.toFixed(3)}deg) rotateY(-10deg) scale(${scale.toFixed(4)})`;
        card.style.opacity = opacity.toFixed(3);
        // Monotonic: the lower card always covers the one above it.
        card.style.zIndex = String(Math.round(1000 - s * 40));
        const shade = shades[i];
        if (shade) shade.style.opacity = Math.max(0.38 * t, 0.92 * fade).toFixed(3);
      }
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(now - last, MAX_DT) : 0;
      last = now;
      let boost = 1;
      if (burstAtRef.current) {
        const k = (now - burstAtRef.current) / BURST_MS;
        if (k >= 1) burstAtRef.current = 0;
        else boost = 1 + (BURST_BOOST - 1) * (1 - Math.max(0, k)) ** 2;
      }
      // Decreasing phase carries every card down the left arc: anticlockwise around the hub.
      phase = (phase - (dt / 1000 / speed) * boost + n) % n;
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      paint();
      schedule();
    };

    const schedule = () => {
      if (!frame && onScreen && !reduced.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };

    // Static start: a card centred in the middle of the arc.
    phase = 0;
    measure();
    paint();
    root.setAttribute('data-ready', '');
    schedule();

    const ro = new ResizeObserver(() => {
      measure();
      paint();
    });
    ro.observe(root);

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              onScreen = entry.isIntersecting;
              if (onScreen) schedule();
              else stop();
            },
            { rootMargin: '120px' }
          );
    io?.observe(root);

    const onVisibility = () => (document.hidden ? stop() : schedule());
    const onMotion = () => {
      if (reduced.matches) {
        stop();
        paint();
      } else schedule();
    };
    const onPointer = (e: PointerEvent) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * -18;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * -14;
    };

    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener?.('change', onMotion);
    if (parallax && !reduced.matches) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener?.('change', onMotion);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [images, speed, visible, parallax]);

  return (
    <div ref={rootRef} className={`po-root ${className}`} aria-hidden="true">
      {images.map((img, i) => {
        const src = typeof img === 'string' ? img : img.src;
        const position = typeof img === 'string' ? undefined : img.position;
        return (
          <div
            key={`${src}-${i}`}
            ref={(el) => {
              cardsRef.current[i] = el;
            }}
            className="po-card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              style={position ? { objectPosition: position } : undefined}
            />
            <div
              ref={(el) => {
                shadesRef.current[i] = el;
              }}
              className="po-shade"
            />
          </div>
        );
      })}
    </div>
  );
}
