import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  applyPauseEvent,
  applyPausedTracks,
  pauseLabel,
  pauseLabelFor,
  pauseMapFromList,
} from '@/lib/mediaPause';
import { hasResumeParam, stripResumeParam } from '@/lib/resumeParam';
import { resumeUrl, canNotify, showOngoingNotification } from '@/hooks/useOngoingNotification';
import { CallMiniBar, callMiniText } from '@/components/call/CallMiniBar';
import { HuddleMiniBar, huddleMiniText } from '@/components/huddles/HuddleMiniBar';

describe('applyPausedTracks', () => {
  const tracks = () => [
    { kind: 'audio', enabled: true },
    { kind: 'video', enabled: true },
  ];

  it('disables every outgoing track while paused', () => {
    const list = tracks();
    applyPausedTracks({ getTracks: () => list }, true, { mic: true, cam: true });
    expect(list.map((t) => t.enabled)).toEqual([false, false]);
  });

  it('restores the user mic and camera choices on resume', () => {
    const list = tracks();
    applyPausedTracks({ getTracks: () => list }, false, { mic: false, cam: true });
    expect(list.map((t) => t.enabled)).toEqual([false, true]);
  });

  it('ignores a missing stream', () => {
    expect(() => applyPausedTracks(null, true, { mic: true, cam: true })).not.toThrow();
  });
});

describe('pause events', () => {
  it('tracks manual pause and away separately', () => {
    let map = applyPauseEvent({}, 'a', 'paused', 'away');
    expect(pauseLabel(map.a)).toBe('Reconnecting…');
    map = applyPauseEvent(map, 'a', 'resumed');
    expect(map.a).toBeUndefined();
    map = applyPauseEvent(map, 'a', 'paused', 'manual');
    expect(pauseLabel(map.a)).toBe('Paused');
    map = applyPauseEvent(map, 'a', 'resumed', 'manual');
    expect(map).toEqual({});
  });

  it('seeds paused people from a join ack and handles an empty list', () => {
    expect(Object.keys(pauseMapFromList(['x', 'y']))).toEqual(['x', 'y']);
    expect(pauseMapFromList(undefined)).toEqual({});
    expect(pauseLabel(null)).toBeNull();
    expect(pauseLabelFor(null)).toBeNull();
    expect(pauseLabelFor('manual')).toBe('Paused');
  });
});

describe('resume param', () => {
  it('detects and strips resume=1', () => {
    expect(hasResumeParam('?resume=1&code=abc')).toBe(true);
    expect(hasResumeParam('')).toBe(false);
    expect(stripResumeParam('https://x.test/rendly.app/dashboard/huddles/h?resume=1&code=abc')).toBe(
      '/rendly.app/dashboard/huddles/h?code=abc',
    );
  });

  it('adds resume=1 to a room path', () => {
    expect(resumeUrl('/dashboard/huddles/h')).toBe('/dashboard/huddles/h?resume=1');
    expect(resumeUrl('/dashboard/huddles/h?code=a')).toBe('/dashboard/huddles/h?code=a&resume=1');
  });
});

describe('ongoing notification guards', () => {
  it('does nothing without notification permission or a service worker', async () => {
    expect(canNotify()).toBe(false);
    await expect(showOngoingNotification({ title: 't', body: 'b', path: '/p' })).resolves.toBe(false);
  });
});

describe('mini bars', () => {
  it('shows an ongoing huddle with Resume', () => {
    const onResume = jest.fn();
    render(<HuddleMiniBar name="Friday chat" onResume={onResume} />);
    expect(screen.getByText('Ongoing huddle · Friday chat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(huddleMiniText('', true)).toBe('Ongoing huddle · Huddle (paused)');
  });

  it('shows an ongoing call with the call type and peer', () => {
    const onResume = jest.fn();
    render(<CallMiniBar callType="audio" peerName="@sam" onResume={onResume} />);
    expect(screen.getByText('Ongoing audio call with @sam')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalled();
    expect(callMiniText('video', '@sam', '01:02')).toBe('Ongoing video call with @sam · 01:02');
  });
});
