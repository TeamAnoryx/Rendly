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
  const [view, setView] = useState<'list' | 'create'>(params?.get('create') === '1' ? 'create' : 'list');

  // Drop ?create=1 once used so Back returns to the list.
  useEffect(() => {
    if (params?.get('create') === '1') window.history.replaceState(null, '', '/dashboard/huddles');
  }, [params]);

  if (view === 'create') {
    return (
      <div className="rd-page hpage">
        <HuddleCreate onCreate={createHuddle} onCancel={() => setView('list')} onSuccess={(id) => router.push(`/dashboard/huddles/${id}`)} />
      </div>
    );
  }

  return (
    <div className="rd-page hpage">
      <header className="hpage-head">
        <div>
          <h1 className="rd-h1">Huddles</h1>
          <p className="rd-muted rd-small">Live rooms for talks, seminars, hackathons and quizzes.</p>
        </div>
        <form
          className="hpage-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setIntent(normaliseIntent(filterDraft) || null);
          }}
        >
          <Icon name="grid" size={16} />
          <input className="rd-input" value={filterDraft} onChange={(e) => setFilterDraft(e.target.value)} placeholder="Filter by #intent" aria-label="Filter huddles by intent" />
          {intent ? (
            <button
              type="button"
              className="rd-btn rd-btn--ghost rd-btn--sm"
              onClick={() => {
                setIntent(null);
                setFilterDraft('');
              }}
            >
              Clear #{intent}
            </button>
          ) : null}
        </form>
        <button type="button" className="rd-btn rd-btn--primary" onClick={() => setView('create')}>
          <Icon name="plus" size={16} /> New huddle
        </button>
      </header>
      <div className="hpage-scroll rd-scroll">
        <HuddleList trendy={trendy} live={live} loading={loading} error={error} onCreate={() => setView('create')} />
      </div>
    </div>
  );
}
