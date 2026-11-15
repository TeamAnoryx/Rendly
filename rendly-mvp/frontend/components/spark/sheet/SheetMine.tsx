'use client';

import React, { useMemo, useState } from 'react';
import type { MyIntent } from '@/services/intentsApi';
import { intentKey, type SelectedSource } from '../setupUtils';
import './sheet-parts.css';

export type SheetMineProps = {
  mine: MyIntent[];
  state: 'loading' | 'ok' | 'error';
  selected: string[];
  maxReached: boolean;
  onRetry(): void;
  onToggle(name: string, source: SelectedSource): void;
};

/** Roughly two rows of chips before the "+N more" toggle. */
const COLLAPSED_COUNT = 8;
const SKELETON_COUNT = 5;

/** "My intents" chips: the viewer's active intents, selectable for the Spark. */
export default function SheetMine({ mine, state, selected, maxReached, onRetry, onToggle }: SheetMineProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedKeys = useMemo(() => new Set(selected.map(intentKey)), [selected]);
  const hidden = Math.max(0, mine.length - COLLAPSED_COUNT);
  const visible = expanded ? mine : mine.slice(0, COLLAPSED_COUNT);

  return (
    <section className="is-section" aria-labelledby="is-mine-title">
      <h3 id="is-mine-title" className="is-section-title">
        My intents
      </h3>

      {state === 'loading' && (
        <div className="is-chips" aria-busy="true" aria-label="Loading your intents">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <span key={i} className="is-chip-skel" />
          ))}
        </div>
      )}

      {state === 'error' && (
        <p className="is-error-line">
          Could not load your intents.{' '}
          <button type="button" className="is-link" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}

      {state === 'ok' && mine.length === 0 && <p className="is-empty">No intents yet. Search or add a custom one.</p>}

      {state === 'ok' && mine.length > 0 && (
        <div className="is-chips">
          {visible.map((intent) => {
            const on = selectedKeys.has(intentKey(intent.name));
            return (
              <button
                key={intent.id}
                type="button"
                className={`is-chip${on ? ' is-on' : ''}`}
                aria-pressed={on}
                disabled={!on && maxReached}
                onClick={() => onToggle(intent.name, 'mine')}
              >
                #{intent.name}
              </button>
            );
          })}
          {hidden > 0 && (
            <button
              type="button"
              className="is-chip is-chip-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : `+${hidden} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
