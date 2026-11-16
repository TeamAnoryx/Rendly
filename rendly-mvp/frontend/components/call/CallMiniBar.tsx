'use client';

import React from 'react';
import { OngoingCard } from './OngoingCard';

export interface CallMiniBarProps {
  callType: 'audio' | 'video';
  /** "@name" of the other person. */
  peerName: string;
  /** Formatted call length, e.g. "02:14". */
  elapsed?: string;
  onResume: () => void;
  children?: React.ReactNode;
}

export function callMiniText(callType: 'audio' | 'video', peerName: string, elapsed?: string): string {
  const base = `Ongoing ${callType} call with ${peerName}`;
  return elapsed ? `${base} · ${elapsed}` : base;
}

/** Shown while a 1:1 call is minimised: the call keeps running, Resume brings the stage back. */
export function CallMiniBar({ callType, peerName, elapsed, onResume, children }: CallMiniBarProps): JSX.Element {
  return (
    <OngoingCard text={callMiniText(callType, peerName, elapsed)} onResume={onResume}>
      {children}
    </OngoingCard>
  );
}

export default CallMiniBar;
