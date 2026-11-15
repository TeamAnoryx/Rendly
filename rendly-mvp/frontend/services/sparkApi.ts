import { authFetch } from '@/lib/api';

export type SparkMode = 'text' | 'video';

/** Built-in intents shown first in the Spark chooser. Any active intent (custom or purchased) is also valid. */
export const SPARK_PRESETS = ['Light chat', 'Brainstorm', 'Motivation', 'Collaborate'] as const;
/** @deprecated Alias of SPARK_PRESETS kept for existing imports. */
export const SPARK_PRESET_INTENTS = SPARK_PRESETS;
export type SparkPresetIntent = (typeof SPARK_PRESETS)[number];
/** Free-text intent name (2..40 chars, validated server-side). */
export type SparkIntent = string;

/** Rendly Token price per intent in a Spark search. Must match the backend quote. */
export const SPARK_PRICE_PRESET = 5;
export const SPARK_PRICE_OTHER = 10;

/** Seconds after which the backend widens the match to any shared active intent. */
export const SPARK_FALLBACK_AFTER_SECONDS = 60;

/** A match is charged (both sides, own cost) only once it has lasted this long. */
export const SPARK_CHARGE_AFTER_SECONDS = 30;
/** Matches allowed per rolling window (see SparkLimits.window_minutes). */
export const SPARK_MATCHES_PER_WINDOW = 20;

/** pending = under 30 s, not charged yet; charged = settled after 30 s; waived = ended before 30 s. */
export type SparkChargeState = 'pending' | 'charged' | 'waived';

export type SparkCharge = {
  state: SparkChargeState;
  /** ISO time the charge settles (matched_at + 30 s), or null when unknown. */
  settles_at: string | null;
  cost: number;
};

export type SparkLimits = {
  balance: number;
  matches_used: number;
  matches_left: number;
  max_per_window: number;
  window_minutes: number;
  /** ISO time the oldest match in the window drops out, or null when nothing is used. */
  resets_at: string | null;
};

const PRESET_KEYS = new Set<string>(SPARK_PRESETS.map((p) => p.toLowerCase()));

/** Token price of one intent: presets cost SPARK_PRICE_PRESET, anything else SPARK_PRICE_OTHER (case-insensitive). */
export function sparkIntentPrice(name: string): number {
  return PRESET_KEYS.has(name.trim().toLowerCase()) ? SPARK_PRICE_PRESET : SPARK_PRICE_OTHER;
}

/** Total token cost of a Spark search over `names` (duplicates, ignoring case, count once). */
export function sparkMatchCost(names: readonly string[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    total += sparkIntentPrice(name);
  }
  return total;
}

export type SparkPartner = {
  display_name: string;
  anonymous: boolean;
  note: string | null;
  can_invite: boolean;
};

/**
 * Transitional fields read by the pre-rewrite match page only. The new backend contract does not
 * send them; remove this once app/dashboard/match/page.tsx is rewritten against the new SparkView.
 * @deprecated
 */
type LegacyWaitingFields = { intent: SparkIntent; fallback?: boolean };
/** @deprecated See LegacyWaitingFields. */
type LegacyMatchedFields = {
  intent: SparkIntent;
  conversation_id: string;
  fallback?: boolean;
  partner: SparkPartner & { id: string; username: string | null; avatar_url: string | null };
};

export type SparkWaiting = {
  status: 'waiting';
  queue_id: string;
  mode: SparkMode;
  intents: string[];
  cost: number;
  waited_seconds: number;
};

export type SparkInsufficient = { status: 'insufficient'; cost: number; balance: number };

export type SparkMatched = {
  status: 'matched';
  mode: SparkMode;
  shared_intents: string[];
  initiator: boolean;
  cost_charged: number;
  partner: SparkPartner;
  /** Deferred charge state for this match (absent on older backends). */
  charge?: SparkCharge;
  /** 'default' when the Default fallback made the pair (+5 tokens); absent on older backends. */
  matched_via?: 'intents' | 'default';
  /** Caller limits as sent with the match status (also on SparkStatus). */
  limits?: SparkLimits;
};

export type SparkView =
  | { status: 'idle' }
  | (SparkWaiting & LegacyWaitingFields)
  | SparkInsufficient
  | (SparkMatched & LegacyMatchedFields);

/** GET /api/match/status: any SparkView plus the caller's current Spark limits. */
export type SparkStatus = SparkView & { limits?: SparkLimits };

export type JoinSparkInput = {
  mode: SparkMode;
  intents: string[];
  note?: string;
  anonymous: boolean;
  /** Default (guaranteed match). The server treats a missing value as on. */
  match_any?: boolean;
};

export type SparkQuote = {
  cost: number;
  breakdown: { intent: string; price: number }[];
  balance: number;
};

/** Thrown by joinSparkQueue when the server answers 402 (not enough tokens). */
export class SparkInsufficientError extends Error {
  readonly cost: number;
  readonly balance: number;

  constructor(cost: number, balance: number, message: string) {
    super(message);
    this.name = 'SparkInsufficientError';
    this.cost = cost;
    this.balance = balance;
  }
}

/** Parse the JSON body, tolerating empty or non-JSON responses from proxies. */
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
  const message = (data as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = await readJson(res);
  if (!res.ok) throw new Error(messageOf(data, fallback));
  return data as T;
}

/** Thrown by joinSparkQueue when the server answers 429 (match limit for the window reached). */
export class SparkRateLimitError extends Error {
  readonly code = 'RATE_LIMITED' as const;
  readonly limits: SparkLimits | null;

  constructor(message: string, limits: SparkLimits | null) {
    super(message);
    this.name = 'SparkRateLimitError';
    this.limits = limits;
  }
}

export function isSparkRateLimitError(e: unknown): e is SparkRateLimitError {
  return e instanceof SparkRateLimitError || (e instanceof Error && (e as { code?: unknown }).code === 'RATE_LIMITED');
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toLimits(raw: unknown): SparkLimits | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    balance: num(r.balance),
    matches_used: num(r.matches_used),
    matches_left: num(r.matches_left),
    max_per_window: num(r.max_per_window, SPARK_MATCHES_PER_WINDOW),
    window_minutes: num(r.window_minutes, 60),
    resets_at: typeof r.resets_at === 'string' ? r.resets_at : null,
  };
}

function toCharge(raw: unknown): SparkCharge | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const state = r.state === 'charged' || r.state === 'waived' ? r.state : 'pending';
  return { state, settles_at: typeof r.settles_at === 'string' ? r.settles_at : null, cost: num(r.cost) };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Join the Spark queue. Returns the current state (waiting or matched). */
export async function joinSparkQueue(input: JoinSparkInput): Promise<SparkView>;
/** @deprecated Legacy single-intent form; maps to { mode, intents: [intent], anonymous: true }. */
export async function joinSparkQueue(mode: SparkMode, intent: SparkIntent): Promise<SparkView>;
export async function joinSparkQueue(arg: JoinSparkInput | SparkMode, intent?: SparkIntent): Promise<SparkView> {
  const input: JoinSparkInput =
    typeof arg === 'string' ? { mode: arg, intents: intent ? [intent] : [], anonymous: true } : arg;
  const body: Record<string, unknown> = { mode: input.mode, intents: input.intents, anonymous: input.anonymous };
  if (input.note !== undefined) body.note = input.note;
  if (input.match_any !== undefined) body.match_any = input.match_any;

  const res = await authFetch('/api/match/queue', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  const data = await readJson(res);
  if (res.status === 402) {
    const d = (data ?? {}) as { cost?: unknown; balance?: unknown };
    throw new SparkInsufficientError(
      Number(d.cost ?? 0),
      Number(d.balance ?? 0),
      messageOf(data, 'Not enough Rendly Tokens for this search')
    );
  }
  if (res.status === 429) {
    const d = (data ?? {}) as { error?: unknown; limits?: unknown };
    const message = typeof d.error === 'string' && d.error ? d.error : messageOf(data, 'Match limit reached, try again soon');
    throw new SparkRateLimitError(message, toLimits(d.limits));
  }
  if (res.status === 503) throw new Error(messageOf(data, 'Spark is temporarily unavailable'));
  if (!res.ok) throw new Error(messageOf(data, 'Could not join the match queue'));
  return data as SparkView;
}

export async function getSparkStatus(): Promise<SparkStatus> {
  const res = await authFetch('/api/match/status');
  return parseOrThrow<SparkStatus>(res, 'Could not read match status');
}

/** The caller's balance and match allowance for the current window. */
export async function getSparkLimits(): Promise<SparkLimits> {
  const res = await authFetch('/api/match/limits');
  const data = await parseOrThrow<unknown>(res, 'Could not read Spark limits');
  const limits = toLimits(data);
  if (!limits) throw new Error('Could not read Spark limits');
  return limits;
}

/** Settle the current match: charges once it has lasted SPARK_CHARGE_AFTER_SECONDS. Idempotent. */
export async function settleMatch(): Promise<{ charge: SparkCharge | null; limits: SparkLimits }> {
  const res = await authFetch('/api/match/settle', { method: 'POST' });
  const data = (await parseOrThrow<{ charge?: unknown; limits?: unknown } | null>(res, 'Could not settle the match')) ?? {};
  const limits = toLimits(data.limits);
  if (!limits) throw new Error('Could not settle the match');
  return { charge: toCharge(data.charge), limits };
}

export async function leaveSparkQueue(): Promise<{ cancelled: number }> {
  const res = await authFetch('/api/match/queue', { method: 'DELETE' });
  return parseOrThrow<{ cancelled: number }>(res, 'Could not leave the match queue');
}

/** Server-side price quote for searching on `intents`, with the viewer's balance. */
export async function getSparkQuote(intents: readonly string[]): Promise<SparkQuote> {
  const q = encodeURIComponent(intents.join(','));
  const res = await authFetch(`/api/match/quote?intents=${q}`);
  return parseOrThrow<SparkQuote>(res, 'Could not price this search');
}

/** Send a connection invite to the current Spark partner (identity stays hidden server-side). */
export async function inviteSparkPartner(): Promise<{ ok: true }> {
  const res = await authFetch('/api/match/invite', { method: 'POST' });
  return parseOrThrow<{ ok: true }>(res, 'Could not send the invite');
}

export type SparkIceConfig = { relay: boolean; iceServers: RTCIceServer[] };

/**
 * ICE servers for the Spark peer connection. `relay: true` means TURN credentials are included and
 * the client must force relay-only transport so neither side learns the other's network address.
 */
export async function getSparkIceConfig(): Promise<SparkIceConfig> {
  const res = await authFetch('/api/match/ice');
  const data = await parseOrThrow<Partial<SparkIceConfig>>(res, 'Video unavailable right now');
  return {
    relay: data?.relay === true,
    iceServers: Array.isArray(data?.iceServers) ? data.iceServers : [],
  };
}
