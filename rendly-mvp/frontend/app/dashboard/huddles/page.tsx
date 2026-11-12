'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import HuddleList from '@/components/huddles/HuddleList';
import HuddleCreate, { normaliseIntent } from '@/components/huddles/HuddleCreate';
import { useHuddles } from '@/hooks/useHuddles';
import { Icon } from '@/components/shell/Icon';
import './huddles.css';

export default function HuddlesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [filterDraft, setFilterDraft] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const { trendy, live, loading, error, createHuddle } = useHuddles(intent);
  const [creating, setCreating] = useState(params?.get('create') === '1');

  // Drop ?create=1 once used so Back returns to the list.
  useEffect(() => {
    if (params?.get('create') === '1') window.history.replaceState(null, '', '/dashboard/huddles');
  }, [params]);

  // Escape closes the create sheet.
  useEffect(() => {
    if (!creating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCreating(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating]);

  return (
    <div className="rd-page hpage">
      <header className="hpage-head">
        <div className="hpage-title">
          <span className="rd-eyebrow">Rooms</span>
          <h1 className="rd-h1">Huddles</h1>
          <p className="rd-muted rd-small">Live rooms for talks, seminars, hackathons and quizzes.</p>
        </div>
        <div className="hpage-actions">
          <form
            className="hpage-filter"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setIntent(normaliseIntent(filterDraft) || null);
            }}
          >
            <span className="hpage-filter-icon" aria-hidden="true">#</span>
            <input className="rd-input" value={filterDraft} onChange={(e) => setFilterDraft(e.target.value)} placeholder="Filter by intent" aria-label="Filter huddles by intent" />
            {intent ? (
              <button
                type="button"
                className="rd-chip rd-chip--on hpage-filter-clear"
                onClick={() => {
                  setIntent(null);
                  setFilterDraft('');
                }}
                aria-label={`Clear filter #${intent}`}
              >
                #{intent} <Icon name="close" size={12} />
              </button>
            ) : null}
          </form>
          <button type="button" className="rd-btn rd-btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New huddle
          </button>
        </div>
      </header>
      <div className="hpage-scroll rd-scroll">
        <HuddleList trendy={trendy} live={live} loading={loading} error={error} onCreate={() => setCreating(true)} />
      </div>

      {creating ? (
        <div
          className="hc-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreating(false);
          }}
        >
          <HuddleCreate onCreate={createHuddle} onCancel={() => setCreating(false)} onSuccess={(id) => router.push(`/dashboard/huddles/${id}`)} />
        </div>
      ) : null}
    </div>
  );
}
