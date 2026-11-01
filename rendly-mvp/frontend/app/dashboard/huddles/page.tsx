'use client';

import React, { useState } from 'react';
import HuddleList from '@/components/huddles/HuddleList';
import HuddleCreate from '@/components/huddles/HuddleCreate';
import { useHuddles } from '@/hooks/useHuddles';
import { normaliseIntent } from '@/components/huddles/HuddleCreate';

export default function HuddlesPage() {
  const [filterDraft, setFilterDraft] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const { trendy, live, loading, error, createHuddle } = useHuddles(intent);
  const [view, setView] = useState<'list' | 'create'>('list');

  return (
    <div className="dash-huddles-root">
      {view === 'list' ? (
        <>
          <div className="dash-huddles-header">
            <h1 className="dash-huddles-page-title">Huddles</h1>
          </div>
          <button
            type="button"
            className="dash-huddles-cta"
            onClick={() => setView('create')}
            aria-label="Create new huddle"
          >
            + new huddle
          </button>
          <form
            className="dash-huddles-create-report-row"
            onSubmit={(e) => {
              e.preventDefault();
              const tag = normaliseIntent(filterDraft);
              setIntent(tag || null);
            }}
          >
            <input
              type="text"
              className="dash-huddles-create-input"
              placeholder="Filter by intent, e.g. ai"
              aria-label="Filter huddles by intent"
              value={filterDraft}
              onChange={(e) => setFilterDraft(e.target.value)}
            />
            <button type="submit" className="dash-huddles-create-btn dash-huddles-create-btn--secondary">Filter</button>
            {intent && (
              <button
                type="button"
                className="dash-huddles-create-btn dash-huddles-create-btn--secondary"
                onClick={() => {
                  setIntent(null);
                  setFilterDraft('');
                }}
              >
                Clear
              </button>
            )}
          </form>
          <HuddleList
            trendy={trendy}
            live={live}
            loading={loading}
            error={error}
          />
        </>
      ) : (
        <HuddleCreate
          onCreate={createHuddle}
          onCancel={() => setView('list')}
          onSuccess={() => setView('list')}
        />
      )}
    </div>
  );
}
