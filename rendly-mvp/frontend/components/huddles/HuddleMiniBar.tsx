'use client';

import React from 'react';
import { OngoingCard } from '@/components/call/OngoingCard';

export interface HuddleMiniBarProps {
  name: string;
  paused?: boolean;
  onResume: () => void;
}

export function huddleMiniText(name: string, paused = false): string {
  return `Ongoing huddle · ${name || 'Huddle'}${paused ? ' (paused)' : ''}`;
}

/** Floating card while the user is in a huddle but browsing another page. */
export function HuddleMiniBar({ name, paused = false, onResume }: HuddleMiniBarProps): JSX.Element {
  return <OngoingCard text={huddleMiniText(name, paused)} onResume={onResume} />;
}

export default HuddleMiniBar;
