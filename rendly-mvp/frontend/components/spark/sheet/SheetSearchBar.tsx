'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { SHEET_SORTS, type SheetSort } from './sheetUtils';
import './sheet-results.css';

export type SheetSearchBarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  sort: SheetSort;
  onSortChange: (s: SheetSort) => void;
  loading: boolean;
};

/** Long pill search field with an inline clear button and a compact native sort select. */
export default function SheetSearchBar({ query, onQueryChange, sort, onSortChange, loading }: SheetSearchBarProps) {
  const sortId = useId();
  return (
    <div className="is-search" role="search">
      <div className="is-search-field">
        <Icon name="search" size={16} className="is-search-icon" />
        <input
          type="search"
          role="searchbox"
          aria-label="Search intents"
          className="is-search-input"
          placeholder="Search intents"
          value={query}
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              onQueryChange('');
            }
          }}
        />
        {loading && <span className="is-spinner" role="status" aria-label="Searching" />}
        {query && (
          <button
            type="button"
            className="is-search-clear"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <SortMenu id={sortId} value={sort} onChange={onSortChange} />
    </div>
  );
}

/** Linear-style sort dropdown: pill trigger + animated listbox with keyboard support. */
function SortMenu({ id, value, onChange }: { id: string; value: SheetSort; onChange: (s: SheetSort) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = SHEET_SORTS.find((s) => s.value === value) ?? SHEET_SORTS[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (next: SheetSort) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={`is-sort${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="is-sort-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort intents: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span>{current.label}</span>
        <Icon name="chevron-right" size={12} className="is-sort-caret" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-labelledby={id}
            className="is-sort-menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {SHEET_SORTS.map((s) => {
              const on = s.value === value;
              return (
                <li key={s.value} role="option" aria-selected={on}>
                  <button
                    type="button"
                    className={`is-sort-opt${on ? ' is-on' : ''}`}
                    onClick={() => pick(s.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setOpen(false);
                      }
                    }}
                  >
                    {s.label}
                    {on && <Icon name="check" size={13} />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
