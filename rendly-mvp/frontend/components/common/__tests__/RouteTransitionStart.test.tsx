import React from 'react';
import { act, render } from '@testing-library/react';
import RouteTransition, { MAX_VISIBLE_MS, startRouteTransition } from '../RouteTransition';

jest.mock('next/navigation', () => ({ usePathname: () => '/login' }));

const loader = () => document.querySelector('[role="status"], [aria-busy="true"]');

describe('startRouteTransition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('shows the loader for a programmatic navigation (router.push / replace)', () => {
    render(<RouteTransition />);
    expect(loader()).toBeNull();
    act(() => startRouteTransition());
    expect(loader()).not.toBeNull();
  });

  test('the loader never stays longer than MAX_VISIBLE_MS', () => {
    render(<RouteTransition />);
    act(() => startRouteTransition());
    act(() => {
      jest.advanceTimersByTime(MAX_VISIBLE_MS);
    });
    expect(loader()).toBeNull();
  });

  test('is a no-op when no RouteTransition is mounted', () => {
    expect(() => startRouteTransition()).not.toThrow();
    expect(loader()).toBeNull();
  });

  test('stops listening after RouteTransition unmounts', () => {
    const { unmount } = render(<RouteTransition />);
    unmount();
    act(() => startRouteTransition());
    expect(loader()).toBeNull();
  });
});
