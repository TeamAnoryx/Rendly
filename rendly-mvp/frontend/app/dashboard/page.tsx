'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useDashboard,
  DASHBOARD_INTENTS,
  type DashboardIntent,
  type Huddle,
} from '@/hooks/useDashboard';
import { formatTimeLeft } from '@/lib/huddleActive';

export default function DashboardPage() {
  const router = useRouter();
  const {
    user,
    stats,
    huddles,
    selectedIntent,
    setSelectedIntent,
    loading,
    joinHuddle,
  } = useDashboard();

  const [isFindingMatch, setIsFindingMatch] = useState(false);
  const [matchResult, setMatchResult] = useState<'found' | 'none' | null>(null);
  const [joiningHuddleId, setJoiningHuddleId] = useState<string | null>(null);
  const findMatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFindMatch = useCallback(() => {
    if (findMatchTimeoutRef.current) clearTimeout(findMatchTimeoutRef.current);
    setIsFindingMatch(true);
    setMatchResult(null);
    findMatchTimeoutRef.current = setTimeout(() => {
      findMatchTimeoutRef.current = null;
      setIsFindingMatch(false);
      setMatchResult('found');
      router.push('/dashboard/chat');
    }, 1500);
  }, [router]);

  useEffect(() => () => {
    if (findMatchTimeoutRef.current) clearTimeout(findMatchTimeoutRef.current);
  }, []);

  const handleJoinHuddle = useCallback(
    async (huddle: Huddle) => {
      if (!huddle.canJoin || joiningHuddleId) return;
      setJoiningHuddleId(huddle.id);
      try {
        await joinHuddle(huddle.id);
        router.push(`/dashboard/huddles/${huddle.id}`);
      } catch {
        setJoiningHuddleId(null);
      }
    },
    [joinHuddle, router, joiningHuddleId]
  );

  return (
    <div className="dash-home-root">
      {/* Hero / stats strip */}
      <section className="dash-home-hero">
        <h1 className="dash-home-hero-title">
          {user?.username ? `Hi, ${user.username}` : 'Welcome'}
        </h1>
        <div className="dash-home-stats">
          <span className="dash-home-stat">
            <strong>{stats.onlineUsers}</strong> online now
          </span>
          <span className="dash-home-stat">
            <strong>{stats.lookingForMatch}</strong> looking for a match
          </span>
          <span className="dash-home-stat">
            ~<strong>{stats.avgMatchTimeMinutes}</strong> min avg match time
          </span>
        </div>
      </section>

      {/* Matching engine card */}
      <section className="dash-home-card dash-home-match-card">
        <h2 className="dash-home-card-title">Find a match</h2>
        <div className="dash-home-intent-pills">
          {DASHBOARD_INTENTS.map((intent) => (
            <button
              key={intent}
              type="button"
              className={`dash-home-intent-pill ${selectedIntent === intent ? 'dash-home-intent-pill--selected' : ''}`}
              onClick={() => setSelectedIntent(intent as DashboardIntent)}
            >
              {intent}
            </button>
          ))}
        </div>
        {stats.lookingForMatch > 0 && (
          <p className="dash-home-looking-now">
            {stats.lookingForMatch} people looking now
          </p>
        )}
        <div className="dash-home-cta-wrap">
          <button
            type="button"
            className="dash-home-cta"
            onClick={handleFindMatch}
            disabled={isFindingMatch}
          >
            {isFindingMatch ? 'Finding…' : 'Find match'}
          </button>
          {matchResult === 'none' && (
            <p className="dash-home-match-msg" role="status">
              No match right now. Try again in a moment.
            </p>
          )}
        </div>
      </section>

      {/* Live huddles */}
      <section className="dash-home-huddles">
        <h2 className="dash-home-section-title">Live Huddles</h2>
        {loading ? (
          <div className="dash-home-huddles-loading">Loading huddles…</div>
        ) : huddles.length === 0 ? (
          <p className="dash-home-huddles-empty">
            No live huddles right now. Check back later.
          </p>
        ) : (
          <div className="dash-home-huddles-grid">
            {huddles.map((huddle) => {
              const joining = joiningHuddleId === huddle.id;
              const canJoin = huddle.canJoin && !joining;
              return (
                <div key={huddle.id} className="dash-home-huddle-card">
                  <h3 className="dash-home-huddle-topic">{huddle.topic}</h3>
                  {huddle.intent && (
                    <span className="dash-home-huddle-intent">{huddle.intent}</span>
                  )}
                  <p className="dash-home-huddle-time">
                    {formatTimeLeft(huddle.timeLeftSeconds)}
                  </p>
                  <div className="dash-home-huddle-participants">
                    <span className="dash-home-huddle-count">
                      {huddle.participantsCount}
                      {huddle.maxParticipants != null
                        ? ` / ${huddle.maxParticipants}`
                        : ''}{' '}
                      participants
                    </span>
                  </div>
                  <button
                    type="button"
                    className="dash-home-huddle-join"
                    disabled={!canJoin}
                    onClick={() => handleJoinHuddle(huddle)}
                  >
                    {joining ? 'Joining…' : 'Join'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
