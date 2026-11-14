'use client';

import React, { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useIsoLayoutEffect } from './useFitCount';
import { useDismiss } from './useDismiss';

export type FitChip = { key: string; node: React.ReactNode };

export type FitChipsProps = {
  chips: readonly FitChip[];
  /** Names the collection, for the "more" button and its popover. */
  label: string;
};

/**
 * Wrapping chips inside a box whose height comes from layout. Chips that do not fit
 * collapse into a "+N more" button that opens a popover holding the rest — no scrolling.
 */
export default function FitChips({ chips, label }: FitChipsProps) {
  const reduce = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState('0x0');
  const [fit, setFit] = useState<{ sig: string; count: number } | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, close);

  const sig = `${chips.map((c) => c.key).join('|')}#${size}`;
  const count = fit && fit.sig === sig ? fit.count : null;

  useIsoLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize(`${el.clientWidth}x${el.clientHeight}`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure with every chip rendered, then keep only the ones that fit.
  useIsoLayoutEffect(() => {
    if (count !== null) return;
    const el = boxRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-chip]'));
    const limit = el.clientHeight + 1;
    let n = 0;
    for (const item of items) {
      if (item.offsetTop + item.offsetHeight > limit) break;
      n += 1;
    }
    setFit({ sig, count: n < items.length ? Math.max(0, n - 1) : n });
  }, [sig, count]);

  const shown = count === null ? chips : chips.slice(0, count);
  const rest = count === null ? [] : chips.slice(count);

  return (
    <div className="ss-fit" ref={wrapRef}>
      <div className="ss-fit__box" ref={boxRef}>
        {shown.map((c) => (
          <span key={c.key} data-chip className="ss-fit__item">
            {c.node}
          </span>
        ))}
        {rest.length > 0 && (
          <span className="ss-fit__item">
            <button
              type="button"
              className="ss-more"
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={() => setOpen((o) => !o)}
            >
              +{rest.length} more
            </button>
          </span>
        )}
      </div>
      <AnimatePresence>
        {open && rest.length > 0 && (
          <motion.div
            className="ss-pop ss-pop--chips"
            role="dialog"
            aria-label={`More ${label}`}
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="ss-pop__title">More {label}</p>
            <div className="ss-chips">
              {rest.map((c) => (
                <React.Fragment key={c.key}>{c.node}</React.Fragment>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
