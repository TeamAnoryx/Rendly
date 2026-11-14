'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';

export type IntentChipProps = {
  label: string;
  price: number;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
};

/** A selectable intent pill with its per-match token cost. */
export default function IntentChip({ label, price, on, disabled, onToggle }: IntentChipProps) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      whileTap={reduce ? undefined : { scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      className={`ss-chip${on ? ' ss-chip--on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
    >
      {on && <Icon name="check" size={13} />}
      <span className="ss-chip__label">{label}</span>
      <span className="ss-coin">
        <TokenCoin size={12} />
        {price}
      </span>
    </motion.button>
  );
}
