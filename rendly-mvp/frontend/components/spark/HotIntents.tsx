'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getHotIntents, purchaseIntent, type Intent } from '@/services/intentsApi';
import { emitPointsChanged, newIdempotencyKey } from '@/services/pointsApi';
import { compactCount } from '@/utils/formatCount';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import { hashtagLabel, intentKey } from './setupUtils';
import PagedList from './setup/PagedList';

/** Per-match price of a non-preset intent (the Spark cost, not the purchase price). */
const HOT_MATCH_PRICE = 10;

export type HotIntentsProps = {
  /** Names currently selected for this Spark. */
  selected: string[];
  /** Names the viewer already holds (no purchase needed). */
  heldNames?: string[];
  maxReached: boolean;
  onSelect: (name: string) => void;
};

type LoadState = 'loading' | 'ok' | 'error';

export default function HotIntents({ selected, heldNames = [], maxReached, onSelect }: HotIntentsProps) {
  const [items, setItems] = useState<Intent[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [owned, setOwned] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setItems(await getHotIntents());
      setState('ok');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedKeys = selected.map(intentKey);
  const heldKeys = [...heldNames, ...owned].map(intentKey);

  const pick = async (intent: Intent) => {
    const key = intentKey(intent.name);
    if (selectedKeys.includes(key) || heldKeys.includes(key) || intent.owned) {
      onSelect(intent.name);
      return;
    }
    setBusyId(intent.id);
    setError(null);
    try {
      const res = await purchaseIntent(intent.id, 'hot', newIdempotencyKey());
      if (res.status === 'ok') emitPointsChanged();
      setOwned((prev) => [...prev, intent.name]);
      onSelect(intent.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this intent');
    } finally {
      setBusyId(null);
    }
  };

  if (state === 'loading') {
    return (
      <div className="ss-paged__viewport ss-list" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ss-row ss-row--skeleton" />
        ))}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="ss-empty" role="alert">
        Could not load trending intents.{' '}
        <button type="button" className="ss-link" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (items.length === 0) return <div className="ss-empty">Nothing is trending yet.</div>;

  return (
    <div className="ss-panel-stack">
      {error && (
        <p className="ss-error" role="alert">
          {error}
        </p>
      )}
      <PagedList
        items={items}
        label="trending intents"
        getKey={(intent) => intent.id}
        renderItem={(intent) => {
          const on = selectedKeys.includes(intentKey(intent.name));
          const disabled = busyId !== null || (!on && maxReached);
          return (
            <button
              type="button"
              className={`ss-row${on ? ' ss-row--on' : ''}`}
              onClick={() => void pick(intent)}
              disabled={disabled}
              aria-pressed={on}
            >
              <span className="ss-count">{compactCount(intent.usage_count)}</span>
              <span className="ss-row__label">{hashtagLabel(intent.name)}</span>
              {busyId === intent.id ? (
                <span className="ss-spinner" aria-label="Adding" />
              ) : on ? (
                <Icon name="check" size={16} />
              ) : (
                <span className="ss-coin">
                  <TokenCoin size={13} />
                  {HOT_MATCH_PRICE}
                </span>
              )}
            </button>
          );
        }}
      />
    </div>
  );
}
