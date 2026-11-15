'use client';

import React, { useMemo } from 'react';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { SPARK_PRESETS, sparkIntentPrice } from '@/services/sparkApi';
import { intentKey, type SelectedSource } from '../setupUtils';
import './sheet-parts.css';

export type SheetPresetsProps = {
  selected: string[];
  maxReached: boolean;
  onToggle(name: string, source: SelectedSource): void;
};

/** The four built-in Spark presets as selectable pills. */
export default function SheetPresets({ selected, maxReached, onToggle }: SheetPresetsProps) {
  const selectedKeys = useMemo(() => new Set(selected.map(intentKey)), [selected]);
  return (
    <section className="is-section" aria-labelledby="is-presets-title">
      <h3 id="is-presets-title" className="is-section-title">
        Quick picks
      </h3>
      <div className="is-chips">
        {SPARK_PRESETS.map((p) => {
          const on = selectedKeys.has(intentKey(p));
          return (
            <button
              key={p}
              type="button"
              className={`is-chip is-preset${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={!on && maxReached}
              onClick={() => onToggle(p, 'preset')}
            >
              <span>{p}</span>
              <span className="is-price">
                <TokenCoin size={12} />
                {sparkIntentPrice(p)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
