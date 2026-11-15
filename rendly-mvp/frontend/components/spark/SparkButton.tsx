'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import './spark-button.css';

export type SparkButtonProps = {
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
};

type Ripple = { id: number; x: number; y: number; size: number };

const RIPPLE_MS = 550;
const PULSE_MS = 600;
const EASE = [0.2, 0.8, 0.2, 1] as const;

export default function SparkButton({
  label = 'Spark',
  busy = false,
  disabled = false,
  onClick,
  className,
}: SparkButtonProps): JSX.Element {
  const reduceMotion = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [pulseKey, setPulseKey] = useState(0);
  const timers = useRef<number[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const inert = busy || disabled;

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (inert) return;
      if (!reduceMotion) {
        const rect = e.currentTarget.getBoundingClientRect();
        const fromKeyboard = e.clientX === 0 && e.clientY === 0;
        const x = fromKeyboard ? rect.width / 2 : e.clientX - rect.left;
        const y = fromKeyboard ? rect.height / 2 : e.clientY - rect.top;
        const size = Math.max(rect.width, rect.height) / 2;
        const id = nextId.current++;
        setRipples((prev) => [...prev, { id, x, y, size }]);
        setPulseKey((k) => k + 1);
        timers.current.push(
          window.setTimeout(() => {
            setRipples((prev) => prev.filter((r) => r.id !== id));
          }, RIPPLE_MS),
        );
      }
      onClick();
    },
    [inert, onClick, reduceMotion],
  );

  const fade = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE };

  const classes = ['sb-btn', busy ? 'sb-btn--busy' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={inert || undefined}
      aria-busy={busy || undefined}
      tabIndex={busy ? -1 : undefined}
    >
      {pulseKey > 0 && !reduceMotion && (
        <span
          key={pulseKey}
          className="sb-pulse"
          aria-hidden="true"
          style={{ animationDuration: `${PULSE_MS}ms` }}
        />
      )}
      <span className="sb-layer" aria-hidden="true">
        <span className="sb-sheen" />
        {ripples.map((r) => (
          <span
            key={r.id}
            className="sb-ripple"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              animationDuration: `${RIPPLE_MS}ms`,
            }}
          />
        ))}
      </span>
      <span className="sb-content">
        <AnimatePresence initial={false} mode="wait">
          {busy ? (
            <motion.span
              key="busy"
              className="sb-inner"
              initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.9 }}
              transition={fade}
            >
              <span className="sb-spinner" aria-hidden="true" />
              <span className="sb-sr">Finding your Spark…</span>
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="sb-inner"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
              transition={fade}
            >
              <Icon name="spark" size={16} className="sb-icon" />
              <span className="sb-label">{label}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
