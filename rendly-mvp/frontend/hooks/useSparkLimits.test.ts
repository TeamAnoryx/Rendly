import { act, renderHook, waitFor } from '@testing-library/react';
import type { SparkLimits } from '@/services/sparkApi';
import {
  __resetSparkLimitsStore,
  formatResetsIn,
  notifySparkLimitsChanged,
  useSparkLimits,
} from './useSparkLimits';

jest.mock('@/services/sparkApi', () => ({ getSparkLimits: jest.fn() }));

import { getSparkLimits } from '@/services/sparkApi';

const mockGet = getSparkLimits as jest.MockedFunction<typeof getSparkLimits>;

function makeLimits(over: Partial<SparkLimits> = {}): SparkLimits {
  return {
    balance: 100,
    matches_used: 2,
    matches_left: 18,
    max_per_window: 20,
    window_minutes: 60,
    resets_at: null,
    ...over,
  };
}

beforeEach(() => {
  __resetSparkLimitsStore();
  mockGet.mockReset();
});

describe('useSparkLimits', () => {
  test('initial fetch populates limits', async () => {
    mockGet.mockResolvedValue(makeLimits());
    const { result } = renderHook(() => useSparkLimits());
    await waitFor(() => expect(result.current.limits?.balance).toBe(100));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('two instances share one fetch', async () => {
    mockGet.mockResolvedValue(makeLimits({ matches_left: 7 }));
    const a = renderHook(() => useSparkLimits());
    const b = renderHook(() => useSparkLimits());
    await waitFor(() => expect(a.result.current.limits?.matches_left).toBe(7));
    await waitFor(() => expect(b.result.current.limits?.matches_left).toBe(7));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('notifySparkLimitsChanged(value) updates every instance without fetching', async () => {
    mockGet.mockResolvedValue(makeLimits());
    const a = renderHook(() => useSparkLimits());
    const b = renderHook(() => useSparkLimits());
    await waitFor(() => expect(a.result.current.limits).not.toBeNull());
    mockGet.mockClear();

    act(() => notifySparkLimitsChanged(makeLimits({ balance: 42 })));

    expect(a.result.current.limits?.balance).toBe(42);
    expect(b.result.current.limits?.balance).toBe(42);
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('notifySparkLimitsChanged() triggers a refetch', async () => {
    mockGet.mockResolvedValueOnce(makeLimits()).mockResolvedValueOnce(makeLimits({ balance: 5 }));
    const { result } = renderHook(() => useSparkLimits());
    await waitFor(() => expect(result.current.limits?.balance).toBe(100));

    act(() => notifySparkLimitsChanged());

    await waitFor(() => expect(result.current.limits?.balance).toBe(5));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('fetch error keeps the previous value', async () => {
    mockGet.mockResolvedValueOnce(makeLimits({ balance: 9 })).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSparkLimits());
    await waitFor(() => expect(result.current.limits?.balance).toBe(9));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.limits?.balance).toBe(9);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('window focus refetches and unmount stops updates', async () => {
    mockGet.mockResolvedValue(makeLimits());
    const { result, unmount } = renderHook(() => useSparkLimits());
    await waitFor(() => expect(result.current.limits).not.toBeNull());

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockGet).toHaveBeenCalledTimes(2);

    unmount();
    mockGet.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('formatResetsIn', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  test('minutes only', () => {
    expect(formatResetsIn('2026-11-15T12:42:00Z', now)).toBe('Resets in 42 min');
  });

  test('hours and minutes', () => {
    expect(formatResetsIn('2026-11-15T13:05:00Z', now)).toBe('Resets in 1 h 5 min');
  });

  test('whole hours', () => {
    expect(formatResetsIn('2026-11-15T13:00:00Z', now)).toBe('Resets in 1 h');
  });

  test('rounds partial minutes up', () => {
    expect(formatResetsIn('2026-11-15T12:00:20Z', now)).toBe('Resets in 1 min');
  });

  test('empty for null, invalid or past', () => {
    expect(formatResetsIn(null, now)).toBe('');
    expect(formatResetsIn('not a date', now)).toBe('');
    expect(formatResetsIn('2026-11-15T11:59:00Z', now)).toBe('');
  });
});
