'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getHuddle, joinHuddle } from '@/services/huddlesApi';
import type { HuddleDetail } from '@/services/huddlesApi';

export default function HuddleDetailPage() {
  const params = useParams();
  const huddleId = typeof params?.huddle_id === 'string' ? params.huddle_id : '';
  const inviteCode = useSearchParams()?.get('code') ?? null;
  const [huddle, setHuddle] = useState<HuddleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!huddleId) {
      setLoading(false);
      setError('Invalid huddle');
      return;
    }
    getHuddle(huddleId, inviteCode)
      .then(setHuddle)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [huddleId, inviteCode]);

  const handleJoin = useCallback(() => {
    if (!huddleId || joining) return;
    setJoining(true);
    joinHuddle(huddleId, inviteCode)
      .then(() => getHuddle(huddleId, inviteCode).then(setHuddle))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to join'))
      .finally(() => setJoining(false));
  }, [huddleId, inviteCode, joining]);

  if (loading) return <div className="dash-huddles-root"><div className="dash-huddles-loading">Loading…</div></div>;
  if (error && !huddle) return <div className="dash-huddles-root"><div className="dash-huddles-error">{error}</div><Link href="/dashboard/huddles">Back to Huddles</Link></div>;
  if (!huddle) return null;

  return (
    <div className="dash-huddles-root">
      <div className="dash-huddles-detail">
        <Link href="/dashboard/huddles" className="dash-huddles-back">← Back to Huddles</Link>
        <h1 className="dash-huddles-page-title">{huddle.title}</h1>
        {huddle.description && <p className="dash-huddles-detail-desc">{huddle.description}</p>}
        <p className="dash-huddles-detail-meta">
          {huddle.participants_count} / {huddle.max_participants} participants · {huddle.type}
        </p>
        {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}
        <button
          type="button"
          className="dash-huddles-create-btn dash-huddles-create-btn--primary"
          onClick={handleJoin}
          disabled={joining || huddle.is_participant}
        >
          {huddle.is_participant ? 'Joined' : joining ? 'Joining…' : 'Join huddle'}
        </button>
      </div>
    </div>
  );
}
