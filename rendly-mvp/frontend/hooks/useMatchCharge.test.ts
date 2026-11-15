import { act, renderHook } from '@testing-library/react';
import type { SparkCharge, SparkLimits } from '@/services/sparkApi';

jest.mock('@/services/sparkApi', () => ({ settleMatch: jest.fn() }));
jest.mock('@/hooks/useSparkLimits', () => ({ notifySparkLimitsChanged: jest.fn() }));

import { settleMatch } from '@/services/sparkApi';
import { notifySparkLimitsChanged } from '@/hooks/useSparkLimits';
import { SPARK_FREE_SECONDS, useMatchCharge } from './useMatchCharge';

const mockSettle = settleMatch as jest.MockedFunction<typeof settleMatch>;
const mockNotify = notifySparkLimitsChanged as jest.MockedFunction<typeof notifySparkLimitsChanged>;

const START = new Date('2026-11-15T12:00:00.000Z').getTime();

const limits: SparkLimits = {
  balance: 90,
  matches_used: 1,
  matches_left: 19,
  max_per_window: 20,
  window_minutes: 60,
  resets_at: null,
};

function pendingCharge(cost = 10): SparkCharge {
  return { state: 'pending', settles_at: new Date(START + SPARK_FREE_SECONDS * 1000).toISOString(), cost };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useMatchCharge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);
    mockSettle.mockReset();
    mockNotify.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts down the free window', async () => {
    const { result } = renderHook(() => useMatchCharge(pendingCharge()));
    expect(result.current.state).toBe('pending');
    expect(result.current.secondsLeft).toBeCloseTo(30, 0);
    expect(result.current.progress).toBeCloseTo(0, 2);

    await advance(10_000);
    expect(result.current.secondsLeft).toBeCloseTo(20, 0);
    expect(result.current.progress).toBeCloseTo(1 / 3, 1);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('settles once at zero and adopts the result', async () => {
    mockSettle.mockResolvedValue({ charge: { state: 'charged', settles_at: null, cost: 12 }, limits });
    const { result } = renderHook(() => useMatchCharge(pendingCharge(10)));

    await advance(31_000);
    await advance(1_000);

    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('charged');
    expect(result.current.cost).toBe(12);
    expect(result.current.secondsLeft).toBe(0);
    expect(mockNotify).toHaveBeenCalledWith(limits);
  });

  it('retries settle once after an error', async () => {
    mockSettle
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ charge: { state: 'charged', settles_at: null, cost: 10 }, limits });
    const { result } = renderHook(() => useMatchCharge(pendingCharge()));

    await advance(31_000);
    expect(mockSettle).toHaveBeenCalledTimes(1);
    await advance(2_500);
    expect(mockSettle).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('charged');
  });

  it('markEnded before 30s waives the charge without settling', async () => {
    const { result } = renderHook(() => useMatchCharge(pendingCharge()));
    await advance(5_000);

    act(() => result.current.markEnded());
    expect(result.current.state).toBe('waived');
    expect(mockNotify).toHaveBeenCalledWith();

    await advance(60_000);
    expect(mockSettle).not.toHaveBeenCalled();
    expect(result.current.state).toBe('waived');
  });

  it('adopts a charged state pushed through props', async () => {
    const initial = pendingCharge(10);
    const { result, rerender } = renderHook(({ charge }) => useMatchCharge(charge), {
      initialProps: { charge: initial as SparkCharge | undefined },
    });
    rerender({ charge: { ...initial, state: 'charged', cost: 10 } });
    expect(result.current.state).toBe('charged');
    expect(result.current.cost).toBe(10);
  });

  it('falls back to a 30s window with cost 0 when charge is undefined', async () => {
    const { result } = renderHook(() => useMatchCharge(undefined));
    expect(result.current.state).toBe('pending');
    expect(result.current.cost).toBe(0);
    expect(result.current.secondsLeft).toBeCloseTo(30, 0);
  });
});
