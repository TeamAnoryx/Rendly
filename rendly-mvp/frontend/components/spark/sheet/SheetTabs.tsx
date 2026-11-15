'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { getHotIntents, type Intent } from '@/services/intentsApi';
import LocationIntentPicker from '../LocationIntentPicker';
import NearbyMapPanel from '../NearbyMap';
import type { SelectedSource } from '../setupUtils';
import SheetResultsGrid from './SheetResultsGrid';
import SideDock from './SideDock';
import { HOT_TOP_N, SHEET_TABS, type SheetTab } from './sheetUtils';
import '../spark-setup.css';
import '../setup/setup-controls.css';
import './sheet-results.css';

export type SheetTabButtonsProps = {
  value: SheetTab | null;
  onChange: (tab: SheetTab | null) => void;
};

/** Three pill toggles; clicking the active one closes its panel. */
export default function SheetTabButtons({ value, onChange }: SheetTabButtonsProps) {
  return (
    <div className="is-tabs" role="group" aria-label="Browse intents">
      {SHEET_TABS.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            className={`is-tab${on ? ' is-tab--on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? null : t.value)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export type SheetTabPanelProps = {
  tab: SheetTab;
  selected: string[];
  heldNames: string[];
  busyId: string | null;
  maxReached: boolean;
  onPickIntent: (intent: Intent, source: SelectedSource) => void;
  onSelectName: (name: string, source: SelectedSource) => void;
};

type HotProps = Omit<SheetTabPanelProps, 'tab' | 'onSelectName'>;

function HotPanel({ selected, heldNames, busyId, maxReached, onPickIntent }: HotProps) {
  const [items, setItems] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getHotIntents()
      .then((list) => {
        if (alive) setItems(list.slice(0, HOT_TOP_N));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load hot intents');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="is-hot">
      <h3 className="is-panel-title">Top {HOT_TOP_N} trending</h3>
      <SheetResultsGrid
        items={items}
        selected={selected}
        heldNames={heldNames}
        busyId={busyId}
        maxReached={maxReached}
        loading={loading}
        error={error}
        onRetry={retry}
        emptyText="Nothing is trending right now."
        priceSource="hot"
        onPick={(i) => onPickIntent(i, 'hot')}
      />
    </div>
  );
}

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function SheetTabPanel(props: SheetTabPanelProps) {
  const { tab, selected, maxReached, onSelectName } = props;
  const reduce = useReducedMotion();
  const shift = reduce ? 0 : 6;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tab}
        className="is-panel"
        role="region"
        aria-label={SHEET_TABS.find((t) => t.value === tab)?.label ?? tab}
        initial={{ opacity: 0, y: shift }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -shift }}
        transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE }}
      >
        {tab === 'hot' && <HotPanel {...props} />}
        {tab === 'location' && (
          <SideDock label="City or country intents" hint="Pick a city or country on the right →">
            <LocationIntentPicker
              selected={selected}
              maxReached={maxReached}
              onSelect={(n) => onSelectName(n, 'location')}
            />
          </SideDock>
        )}
        {tab === 'nearby' && (
          <NearbyMapPanel
            selected={selected}
            maxReached={maxReached}
            onSelect={(n) => onSelectName(n, 'nearby')}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
