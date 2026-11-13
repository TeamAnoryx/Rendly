'use client';

import React, { useEffect, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import { Icon } from '@/components/shell/Icon';
import { intentPriceLabel, searchIntents, type Intent } from '@/services/intentsApi';

const PICKER_LIMIT = 50;
const DEBOUNCE_MS = 250;

export type IntentPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the search box (usually the text typed in the inline search). */
  initialQuery?: string;
  /** Viewer's user id, used to mark own intents as free. */
  viewerId?: string | null;
  /** Intent ids the viewer already has active; shown as "Added" and not clickable. */
  ownedIds?: ReadonlySet<string>;
  /** Called when a cell is clicked; the parent confirms the price and purchases. */
  onPick: (intent: Intent) => void;
};

/** Full search results grid (2–4 columns) with usage counts and prices. */
export default function IntentPickerDialog({ open, onClose, initialQuery = '', viewerId, ownedIds, onPick }: IntentPickerDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Intent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setResults(null);
    setError(null);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchIntents(q, PICKER_LIMIT)
        .then((list) => {
          if (id !== reqId.current) return;
          setResults(list);
          setError(null);
        })
        .catch((err) => {
          if (id !== reqId.current) return;
          setError(err instanceof Error ? err.message : 'Could not search intents');
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [open, query]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="ipk">
        <div className="ipk-head">
          <label className="ipk-search">
            <Icon name="search" size={16} className="ipk-search-icon" />
            <input
              ref={inputRef}
              className="rd-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search intents…"
              aria-label="Search intents"
              autoComplete="off"
            />
          </label>
          <button type="button" className="ipk-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        {error ? (
          <p className="acct-msg acct-msg--error" role="alert">
            {error}
          </p>
        ) : null}

        {loading && results === null ? (
          <div className="ipk-grid" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rd-skeleton ipk-skel" />
            ))}
          </div>
        ) : !query.trim() ? (
          <p className="ipk-empty">Type to search public intents. Prefix matches, up to {PICKER_LIMIT} results.</p>
        ) : results && results.length === 0 && !loading ? (
          <p className="ipk-empty">No intents start with “{query.trim()}”. You can create it instead.</p>
        ) : (
          <ul className={`ipk-grid${loading ? ' ipk-grid--busy' : ''}`} aria-label="Search results" aria-busy={loading}>
            {(results ?? []).map((intent) => {
              const mine = !!viewerId && intent.creator_id === viewerId;
              const owned = !!intent.owned || !!ownedIds?.has(intent.id);
              const count = intent.active_users ?? intent.usage_count ?? 0;
              return (
                <li key={intent.id}>
                  <button
                    type="button"
                    className={`ipk-cell${owned ? ' ipk-cell--owned' : ''}`}
                    onClick={() => !owned && onPick(intent)}
                    disabled={owned}
                    aria-label={`${intent.name}, ${count} users, ${owned ? 'already added' : intentPriceLabel(intent, 'search', mine)}`}
                  >
                    <span className="ipk-count" title="People using this intent">
                      {count.toLocaleString('en-IN')}
                    </span>
                    <span className="ipk-name">{intent.name}</span>
                    <span className={`ipk-price${owned ? '' : mine ? ' ipk-price--free' : ''}`}>
                      {owned ? 'Added' : intentPriceLabel(intent, 'search', mine)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
