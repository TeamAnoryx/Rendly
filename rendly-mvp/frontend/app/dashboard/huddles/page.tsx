'use client';

import React, { useState } from 'react';
import HuddleList from '@/components/huddles/HuddleList';
import HuddleCreate from '@/components/huddles/HuddleCreate';
import { useHuddles } from '@/hooks/useHuddles';

export default function HuddlesPage() {
  const { trendy, live, loading, error, createHuddle, joinHuddle } = useHuddles();
  const [view, setView] = useState<'list' | 'create'>('list');

  return (
    <div className="dash-huddles-root">
      {view === 'list' ? (
        <>
          <div className="dash-huddles-header">
            <h1 className="dash-huddles-page-title">Huddles</h1>
          </div>
          <HuddleList
            trendy={trendy}
            live={live}
            loading={loading}
            error={error}
            onJoin={joinHuddle}
          />
          <button
            type="button"
            className="dash-huddles-cta"
            onClick={() => setView('create')}
            aria-label="Create new huddle"
          >
            + new huddle
          </button>
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
