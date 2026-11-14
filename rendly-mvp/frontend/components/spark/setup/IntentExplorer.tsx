'use client';

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import HotIntents from '../HotIntents';
import LocationIntentPicker from '../LocationIntentPicker';
import NearbyMapPanel from '../NearbyMap';
import Segmented, { type SegmentOption } from './Segmented';

type Category = 'hot' | 'location' | 'nearby';
const CATEGORIES: readonly SegmentOption<Category>[] = [
  { value: 'hot', label: 'Hot', icon: 'flame' },
  { value: 'location', label: 'Location', icon: 'globe' },
  { value: 'nearby', label: 'Near By', icon: 'map-pin' },
];

export type IntentExplorerProps = {
  selected: string[];
  heldNames: string[];
  maxReached: boolean;
  onPick: (name: string, source: Category) => void;
};

/** Discover intents: trending, by place, or near you. Each panel fits its box and pages. */
export default function IntentExplorer({ selected, heldNames, maxReached, onPick }: IntentExplorerProps) {
  const reduce = useReducedMotion();
  const [category, setCategory] = useState<Category>('hot');

  return (
    <div className="ss-explorer">
      <div className="ss-explorer__head">
        <h2 className="ss-label">Discover</h2>
        <Segmented
          options={CATEGORIES}
          value={category}
          onChange={setCategory}
          label="Discover intents"
          inkId="ss-discover-ink"
          kind="tab"
          size="sm"
        />
      </div>
      <motion.div
        key={category}
        className="ss-tabpanel"
        role="tabpanel"
        aria-label={CATEGORIES.find((c) => c.value === category)?.label}
        initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {category === 'hot' && (
          <HotIntents
            selected={selected}
            heldNames={heldNames}
            maxReached={maxReached}
            onSelect={(n) => onPick(n, 'hot')}
          />
        )}
        {category === 'location' && (
          <LocationIntentPicker selected={selected} maxReached={maxReached} onSelect={(n) => onPick(n, 'location')} />
        )}
        {category === 'nearby' && (
          <NearbyMapPanel selected={selected} maxReached={maxReached} onSelect={(n) => onPick(n, 'nearby')} />
        )}
      </motion.div>
    </div>
  );
}
