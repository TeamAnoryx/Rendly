import { authFetch } from '@/lib/api';
import { SparkInsufficientError } from '@/services/sparkApi';
import {
  SHEET_SEEN_KEY,
  SparkRateLimitError,
  formatResetTime,
  hasSeenIntentSheet,
  joinSparkWithLimits,
  markIntentSheetSeen,
  normalizeNote,
  rateLimitMessage,
  type LaunchLimits,
} from './sparkLaunch';

jest.mock('@/lib/api', () => ({ authFetch: jest.fn() }));

const mockedFetch = authFetch as jest.MockedFunction<typeof authFetch>;
const NOW = new Date('2026-11-15T12:00:00.000Z');

function limitsAt(resetsAt: string | null): LaunchLimits {
  return { balance: 40, matches_used: 20, matches_left: 0, max_per_window: 20, window_minutes: 60, resets_at: resetsAt };
}

function fakeResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(text) } as unknown as Response;
}

const INPUT = { mode: 'text' as const, intents: ['Brainstorm'], anonymous: false };

describe('normalizeNote', () => {
  test('trims and collapses inner whitespace', () => {
    expect(normalizeNote('  hello   there \n friend ')).toBe('hello there friend');
  });

  test('cuts the note at 200 characters', () => {
    expect(normalizeNote('a'.repeat(250))).toHaveLength(200);
  });

  test('returns undefined for blank notes', () => {
    expect(normalizeNote('   \n\t ')).toBeUndefined();
  });
});

describe('formatResetTime', () => {
  test('returns soon for null', () => {
    expect(formatResetTime(null, NOW)).toBe('soon');
  });

  test('returns soon for a time in the past or an invalid date', () => {
    expect(formatResetTime('2026-11-15T11:00:00.000Z', NOW)).toBe('soon');
    expect(formatResetTime('not a date', NOW)).toBe('soon');
  });

  test('returns minutes when the reset is under an hour away', () => {
    expect(formatResetTime('2026-11-15T12:12:00.000Z', NOW)).toBe('in 12 min');
  });

  test('returns a clock time when the reset is over an hour away', () => {
    expect(formatResetTime('2026-11-15T14:05:00.000Z', NOW)).toMatch(/^at /);
  });
});

describe('rateLimitMessage', () => {
  test('mentions the window size when limits are known', () => {
    const err = new SparkRateLimitError('limited', limitsAt('2026-11-15T12:12:00.000Z'));
    expect(rateLimitMessage(err, NOW)).toBe("You've used all 20 Sparks for this hour. More unlock in 12 min.");
  });

  test('falls back to a generic message when limits are missing', () => {
    const err = new SparkRateLimitError('limited', null);
    expect(rateLimitMessage(err, NOW)).toBe("You've reached the Spark limit. Try again soon.");
  });
});

describe('intent sheet session flag', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.sessionStorage.clear();
  });

  test('round trips through sessionStorage', () => {
    expect(hasSeenIntentSheet()).toBe(false);
    markIntentSheetSeen();
    expect(window.sessionStorage.getItem(SHEET_SEEN_KEY)).toBe('1');
    expect(hasSeenIntentSheet()).toBe(true);
  });

  test('swallows storage errors', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markIntentSheetSeen()).not.toThrow();
    expect(hasSeenIntentSheet()).toBe(false);
  });
});

describe('joinSparkWithLimits', () => {
  beforeEach(() => mockedFetch.mockReset());

  test('throws SparkRateLimitError carrying limits on 429', async () => {
    const limits = limitsAt('2026-11-15T12:30:00.000Z');
    mockedFetch.mockResolvedValue(fakeResponse(429, { error: 'Too many Sparks', code: 'RATE_LIMITED', limits }));

    const err = await joinSparkWithLimits(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SparkRateLimitError);
    const rl = err as SparkRateLimitError;
    expect(rl.message).toBe('Too many Sparks');
    expect(rl.limits).toEqual(limits);
    expect(rl.resetsAt).toBe('2026-11-15T12:30:00.000Z');
  });

  test('gives null limits when the 429 body is empty', async () => {
    mockedFetch.mockResolvedValue(fakeResponse(429, undefined));

    const err = await joinSparkWithLimits(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SparkRateLimitError);
    expect((err as SparkRateLimitError).limits).toBeNull();
    expect((err as SparkRateLimitError).message).toBe('Spark limit reached');
  });

  test('throws SparkInsufficientError on 402', async () => {
    mockedFetch.mockResolvedValue(fakeResponse(402, { cost: 10, balance: 3, message: 'Not enough' }));

    const err = await joinSparkWithLimits(INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SparkInsufficientError);
    expect((err as SparkInsufficientError).cost).toBe(10);
    expect((err as SparkInsufficientError).balance).toBe(3);
  });

  test('returns the view on 200 and omits a blank note', async () => {
    const view = { status: 'idle' };
    mockedFetch.mockResolvedValue(fakeResponse(200, view));

    const result = await joinSparkWithLimits({ ...INPUT, note: '   ' });

    expect(result).toEqual(view);
    const body = JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
    expect(body).toEqual({ mode: 'text', intents: ['Brainstorm'], anonymous: false });
  });

  test('sends match_any when set', async () => {
    mockedFetch.mockResolvedValue(fakeResponse(200, { status: 'idle' }));

    await joinSparkWithLimits({ ...INPUT, match_any: false });
    await joinSparkWithLimits({ ...INPUT, match_any: true });

    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body)).match_any).toBe(false);
    expect(JSON.parse(String(mockedFetch.mock.calls[1][1]?.body)).match_any).toBe(true);
  });

  test('sends a normalized note when present', async () => {
    mockedFetch.mockResolvedValue(fakeResponse(200, { status: 'idle' }));

    await joinSparkWithLimits({ ...INPUT, note: '  hi   there ' });

    const body = JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
    expect(body.note).toBe('hi there');
  });
});
