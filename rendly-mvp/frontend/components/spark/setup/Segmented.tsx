'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';

export type SegmentOption<T extends string> = { value: T; label: string; icon?: string };

export type SegmentedProps<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Unique id for the sliding indicator (one per control on screen). */
  inkId: string;
  /** radio = a setting (radiogroup); tab = switches a view (tablist). */
  kind?: 'radio' | 'tab';
  size?: 'md' | 'sm';
  className?: string;
};

/** Pill segmented control with a sliding active indicator. */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  inkId,
  kind = 'radio',
  size = 'md',
  className = '',
}: SegmentedProps<T>) {
  const reduce = useReducedMotion();
  const isTab = kind === 'tab';

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = options[(i + step + options.length) % options.length];
    onChange(next.value);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
    btn?.focus();
  };

  return (
    <div
      className={`ss-seg ss-seg--${size} ${className}`}
      role={isTab ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-value={o.value}
            role={isTab ? 'tab' : 'radio'}
            aria-checked={isTab ? undefined : on}
            aria-selected={isTab ? on : undefined}
            tabIndex={on ? 0 : -1}
            className={`ss-seg__btn${on ? ' ss-seg__btn--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {on && (
              <motion.span
                layoutId={reduce ? undefined : inkId}
                className="ss-seg__ink"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                aria-hidden="true"
              />
            )}
            <span className="ss-seg__label">
              {o.icon && <Icon name={o.icon} size={size === 'sm' ? 14 : 15} />}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
