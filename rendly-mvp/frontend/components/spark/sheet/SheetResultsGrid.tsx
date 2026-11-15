'use client';

import React from 'react';
import { Icon } from '@/components/shell/Icon';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { intentPrice, type Intent, type IntentSource } from '@/services/intentsApi';
import { intentKey } from '../setupUtils';
import { countBox, tileLabel } from './sheetUtils';
import './sheet-results.css';

export type SheetResultsGridProps = {
  items: Intent[];
  selected: string[];
  heldNames: string[];
  busyId: string | null;
  maxReached: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyText: string;
  onPick: (intent: Intent) => void;
  /** Where the tiles came from; drives the shown price. Defaults to 'search'. */
  priceSource?: IntentSource;
};

const SKELETON_COUNT = 8;
const STAGGER_MS = 28;
const STAGGER_CAP = 12;

function toKeySet(names: readonly string[]): Set<string> {
  return new Set(names.map(intentKey));
}

export default function SheetResultsGrid({
  items,
  selected,
  heldNames,
  busyId,
  maxReached,
  loading = false,
  error = null,
  onRetry,
  emptyText,
  onPick,
  priceSource = 'search',
}: SheetResultsGridProps) {
  if (loading && items.length === 0) {
    return (
      <div className="is-grid" aria-busy="true" aria-label="Loading intents">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <span key={i} className="is-tile is-tile--skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="is-grid-msg is-grid-msg--error" role="alert">
        {error}
        {onRetry && (
          <>
            {' '}
            <button type="button" className="is-link" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="is-grid-msg">{emptyText}</p>;
  }

  const selectedKeys = toKeySet(selected);
  const heldKeys = toKeySet(heldNames);

  return (
    <div className="is-grid">
      {items.map((intent, i) => {
        const key = intentKey(intent.name);
        const on = selectedKeys.has(key);
        const held = heldKeys.has(key) || intent.owned === true || intent.is_mine === true;
        const busy = busyId === intent.id;
        const disabled = (!on && maxReached) || busyId !== null;
        const price = held ? 0 : intentPrice(intent, priceSource, false);
        const label = tileLabel(intent.name);
        const style = { '--is-delay': `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` } as React.CSSProperties;
        return (
          <button
            key={intent.id || key}
            type="button"
            className={`is-tile${on ? ' is-tile--on' : ''}${busy ? ' is-tile--busy' : ''}`}
            style={style}
            aria-pressed={on}
            aria-label={`${label}, ${intent.usage_count} uses${price > 0 ? `, ${price} tokens` : ''}`}
            disabled={disabled}
            onClick={() => onPick(intent)}
          >
            <span className="is-count" aria-hidden="true">
              {countBox(intent.usage_count)}
            </span>
            <span className="is-tile-label" aria-hidden="true">
              {label}
            </span>
            <span className="is-tile-end" aria-hidden="true">
              {busy ? (
                <span className="is-spinner" />
              ) : on ? (
                <Icon name="check" size={14} className="is-tile-check" />
              ) : price > 0 ? (
                <span className="is-price">
                  <TokenCoin size={12} />
                  {price}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
