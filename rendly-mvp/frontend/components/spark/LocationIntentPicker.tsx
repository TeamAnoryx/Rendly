'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  createLocationIntent,
  getLocationIntents,
  type Intent,
  type LocationIntentScope,
} from '@/services/intentsApi';
import { emitPointsChanged } from '@/services/pointsApi';
import { Icon } from '@/components/shell/Icon';
import { compactCount } from '@/utils/formatCount';
import { LOCATION_NAME_MAX, intentKey, normalizeLocationName, validateLocationName } from './setupUtils';
import PagedList from './setup/PagedList';
import Segmented, { type SegmentOption } from './setup/Segmented';

export type LocationIntentPickerProps = {
  selected: string[];
  maxReached: boolean;
  onSelect: (name: string) => void;
};

const SCOPES: readonly SegmentOption<LocationIntentScope>[] = [
  { value: 'city', label: 'City' },
  { value: 'country', label: 'Country' },
];
const MAX_SUGGESTIONS = 6;

function matchesScope(intent: Intent, scope: LocationIntentScope): boolean {
  return scope === 'city' ? Boolean(intent.city) : Boolean(intent.country) && !intent.city;
}

export default function LocationIntentPicker({ selected, maxReached, onSelect }: LocationIntentPickerProps) {
  const [scope, setScope] = useState<LocationIntentScope>('city');
  const [value, setValue] = useState('');
  const [all, setAll] = useState<Intent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let alive = true;
    getLocationIntents()
      .then((list) => alive && setAll(list))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(() => {
    const prefix = intentKey(value);
    return all
      .filter((i) => matchesScope(i, scope) && (!prefix || intentKey(i.name).startsWith(prefix)))
      .slice(0, MAX_SUGGESTIONS);
  }, [all, scope, value]);

  const validation = validateLocationName(value);
  const selectedKeys = selected.map(intentKey);

  const add = async (raw: string) => {
    const problem = validateLocationName(raw);
    if (problem) {
      setTouched(true);
      setError(problem);
      return;
    }
    const name = normalizeLocationName(raw);
    if (selectedKeys.includes(intentKey(name))) {
      onSelect(name);
      return;
    }
    if (maxReached) {
      setError('You can pick up to 5 intents');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const intent = await createLocationIntent(scope, name);
      emitPointsChanged();
      setAll((prev) => (prev.some((p) => p.id === intent.id) ? prev : [...prev, intent]));
      setValue('');
      setTouched(false);
      onSelect(intent.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this location');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ss-loc">
      <Segmented
        options={SCOPES}
        value={scope}
        onChange={setScope}
        label="Location type"
        inkId="ss-scope-ink"
        kind="tab"
        size="sm"
      />

      <form
        className="ss-loc__form"
        onSubmit={(e) => {
          e.preventDefault();
          void add(value);
        }}
      >
        <input
          className="ss-input"
          value={value}
          maxLength={LOCATION_NAME_MAX}
          placeholder={scope === 'city' ? 'e.g. Lisbon' : 'e.g. Portugal'}
          aria-label={scope === 'city' ? 'City name' : 'Country name'}
          aria-invalid={touched && Boolean(validation)}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onBlur={() => setTouched(value.length > 0)}
        />
        <button type="submit" className="ss-btn ss-btn--ghost" disabled={busy || Boolean(validation)}>
          {busy ? <span className="ss-spinner" aria-label="Adding" /> : <Icon name="plus" size={16} />}
          Add
        </button>
      </form>

      {(error || (touched && validation)) && (
        <p className="ss-error" role="alert">
          {error ?? validation}
        </p>
      )}
      {loadError && <p className="ss-hint">Suggestions are unavailable right now.</p>}

      {suggestions.length > 0 && (
        <PagedList
          items={suggestions}
          label="location suggestions"
          getKey={(item) => item.id}
          renderItem={(item) => {
            const on = selectedKeys.includes(intentKey(item.name));
            return (
              <button
                type="button"
                className={`ss-row${on ? ' ss-row--on' : ''}`}
                aria-pressed={on}
                disabled={busy || (!on && maxReached)}
                onClick={() => (on ? onSelect(item.name) : void add(item.name))}
              >
                <span className="ss-count">{compactCount(item.usage_count)}</span>
                <span className="ss-row__label">
                  <Icon name="map-pin" size={14} /> {item.name}
                </span>
                {on && <Icon name="check" size={16} />}
              </button>
            );
          }}
        />
      )}
    </div>
  );
}
