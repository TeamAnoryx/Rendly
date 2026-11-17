'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import HuddleCreate from '@/components/huddles/HuddleCreate';
import HuddleSearch from '@/components/huddles/HuddleSearch';
import HuddleBoard from '@/components/huddles/HuddleBoard';
import HuddleShowcase from '@/components/huddles/showcase/HuddleShowcase';
import HotHuddles from '@/components/home/HotHuddles';
import { useHuddles } from '@/hooks/useHuddles';
import { Icon } from '@/components/shell/Icon';
import './huddles.css';
import './hp-layout.css';

export default function HuddlesPage() {
  const router = useRouter();
  const params = useSearchParams();
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

  // Intent tags on loaded huddles, most common first, offered as search suggestions.
  const knownIntents = useMemo(() => {
    const counts = new Map<string, number>();
    [...live, ...trendy].forEach((h) => h.intents?.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [live, trendy]);

  return (
    <div className="hpg">
      <div className="hp-main">
        <header className="hp-head">
          <div className="hp-title">
            <span className="hp-eyebrow">Rooms</span>
            <h1 className="hp-h1">Huddles</h1>
            <p className="hp-sub">Live rooms for talks, seminars, hackathons and launches, yours and everyone&apos;s.</p>
          </div>
          <button type="button" className="hp-new" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New huddle
          </button>
        </header>

        <HuddleSearch className="hp-search" intent={intent} onIntent={setIntent} knownIntents={knownIntents} />

        <HotHuddles className="hp-hot" showHostCta={false} />

        <HuddleBoard
          className="hp-board"
          trendy={trendy}
          live={live}
          loading={loading}
          error={error}
          intent={intent}
          onCreate={() => setCreating(true)}
        />
      </div>

      <HuddleShowcase className="hp-stage" />

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
