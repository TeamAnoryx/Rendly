'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';

export type PersonMenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Shown but not usable (feature turned off for this huddle). */
  locked?: boolean;
  lockedHint?: string;
  danger?: boolean;
  /** Toggle that is currently on (e.g. "Sharing allowed"). */
  active?: boolean;
};

const EASE = [0.22, 1, 0.36, 1] as const;

/** Pill button that opens a participant's actions. */
export function PersonMenuTrigger({
  open,
  onToggle,
  label,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`hr-pm-trigger ${open ? 'hr-pm-trigger--open' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Actions for ${label}`}
      disabled={disabled}
    >
      <span>Manage</span>
      <span className="hr-pm-chevron" aria-hidden>
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}

/**
 * The action list under a participant row. It animates its height, so rows below slide down while it
 * opens and back up as it closes. `children` (e.g. a token form) expands the same cell further.
 */
export default function PersonMenu({
  open,
  items,
  children,
}: {
  open: boolean;
  items: PersonMenuItem[];
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const extra = React.Children.toArray(children);
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="menu"
          className="hr-pm"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
        >
          <div className="hr-pm-inner" role="menu">
            {items.map((it, i) => (
              <motion.button
                key={it.key}
                type="button"
                role="menuitem"
                className={`hr-pm-item ${it.danger ? 'hr-pm-item--danger' : ''} ${it.active ? 'hr-pm-item--on' : ''}`}
                disabled={it.locked}
                title={it.locked ? it.lockedHint : undefined}
                onClick={it.onSelect}
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.03 * i, duration: 0.18 }}
              >
                <span className="hr-pm-icon" aria-hidden>
                  {it.icon}
                </span>
                <span className="hr-pm-label">{it.label}</span>
                {it.locked ? (
                  <span className="hr-pm-lock" aria-hidden>
                    <Icon name="lock" size={12} />
                  </span>
                ) : null}
              </motion.button>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {extra.length > 0 ? (
              <motion.div
                key="extra"
                initial={reduce ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
                style={{ overflow: 'hidden' }}
              >
                {extra}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
