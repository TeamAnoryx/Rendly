import { authFetch } from '@/lib/api';
import { SparkInsufficientError, type JoinSparkInput, type SparkView } from '@/services/sparkApi';

export const SHEET_SEEN_KEY = 'rendly.spark.sheetSeen';

const NOTE_MAX = 200;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Structurally identical to Team A's SparkLimits (kept local so this file has no hard dependency). */
export type LaunchLimits = {
  balance: number;
  matches_used: number;
  matches_left: number;
  max_per_window: number;
  window_minutes: number;
  resets_at: string | null;
};

/** Thrown by joinSparkWithLimits when the server answers 429 RATE_LIMITED. */
export class SparkRateLimitError extends Error {
  readonly limits: LaunchLimits | null;
  readonly resetsAt: string | null;

  constructor(message: string, limits: LaunchLimits | null) {
    super(message);
    this.name = 'SparkRateLimitError';
    this.limits = limits;
    this.resetsAt = limits?.resets_at ?? null;
  }
}

function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function hasSeenIntentSheet(): boolean {
  try {
    return sessionStore()?.getItem(SHEET_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntentSheetSeen(): void {
  try {
    sessionStore()?.setItem(SHEET_SEEN_KEY, '1');
  } catch {
    // Storage may be full or blocked; the sheet will just show again.
  }
}

/** Trim, collapse whitespace and cap at 200 chars. Blank notes become undefined. */
export function normalizeNote(raw: string): string | undefined {
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX).trim();
  return cleaned ? cleaned : undefined;
}

/** Human phrase for when the Spark window resets: 'in 12 min', 'at 14:05' or 'soon'. */
export function formatResetTime(resetsAt: string | null, now: Date = new Date()): string {
  if (!resetsAt) return 'soon';
  const at = new Date(resetsAt);
  const diffMs = at.getTime() - now.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 'soon';
  const minutes = Math.max(1, Math.ceil(diffMs / MINUTE_MS));
  if (minutes <= HOUR_MINUTES) return `in ${minutes} min`;
  return `at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function rateLimitMessage(err: SparkRateLimitError, now: Date = new Date()): string {
  const when = formatResetTime(err.resetsAt, now);
  if (!err.limits) return `You've reached the Spark limit. Try again ${when}.`;
  return `You've used all ${err.limits.max_per_window} Sparks for this hour. More unlock ${when}.`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isLaunchLimits(v: unknown): v is LaunchLimits {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const numeric = ['balance', 'matches_used', 'matches_left', 'max_per_window', 'window_minutes'];
  return numeric.every((k) => isFiniteNumber(o[k])) && (o.resets_at === null || typeof o.resets_at === 'string');
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function messageOf(data: unknown, fallback: string): string {
  const d = (data ?? {}) as { error?: unknown; message?: unknown };
  if (typeof d.error === 'string' && d.error) return d.error;
  if (typeof d.message === 'string' && d.message) return d.message;
  return fallback;
}

function buildBody(input: JoinSparkInput): Record<string, unknown> {
  const note = normalizeNote(input.note ?? '');
  const base: Record<string, unknown> = { mode: input.mode, intents: input.intents, anonymous: input.anonymous };
  // Default (guaranteed match) must reach the server, or a Default request is queued without it.
  const withAny = typeof input.match_any === 'boolean' ? { ...base, match_any: input.match_any } : base;
  return note === undefined ? withAny : { ...withAny, note };
}

function insufficientError(data: unknown): SparkInsufficientError {
  const d = (data ?? {}) as { cost?: unknown; balance?: unknown };
  return new SparkInsufficientError(
    Number(d.cost ?? 0),
    Number(d.balance ?? 0),
    messageOf(data, 'Not enough Rendly Tokens for this search')
  );
}

/** Join the Spark queue, keeping the 429 rate-limit details that joinSparkQueue drops. */
export async function joinSparkWithLimits(input: JoinSparkInput): Promise<SparkView> {
  const res = await authFetch('/api/match/queue', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(buildBody(input)),
  });
  const data = await readJson(res);
  if (res.status === 429) {
    const limits = (data as { limits?: unknown } | null)?.limits;
    throw new SparkRateLimitError(messageOf(data, 'Spark limit reached'), isLaunchLimits(limits) ? limits : null);
  }
  if (res.status === 402) throw insufficientError(data);
  if (res.status === 503) throw new Error(messageOf(data, 'Spark is temporarily unavailable'));
  if (!res.ok) throw new Error(messageOf(data, 'Could not join the match queue'));
  return data as SparkView;
}
