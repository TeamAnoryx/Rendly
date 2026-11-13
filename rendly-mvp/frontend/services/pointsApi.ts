import { authFetch } from '@/lib/api';

/** Ledger reasons the backend writes; `category` groups them for the UI. */
export type PointsReason = 'signup_bonus' | 'huddle_award' | 'huddle_send' | 'transfer' | 'intent_purchase' | 'intent_royalty';
export type PointsCategory = 'signup' | 'huddle_award' | 'huddle_send' | 'transfer' | 'intent_purchase' | 'intent_royalty';

export type PointsEntry = {
  amount: number;
  reason: string;
  note: string | null;
  huddle_id: string | null;
  created_at: string;
  category?: PointsCategory | string | null;
  counterparty_id?: string | null;
  counterparty_username?: string | null;
  counterparty_avatar_url?: string | null;
  intent_id?: string | null;
  intent_name?: string | null;
  conversation_id?: string | null;
  transfer_id?: string | null;
  purpose?: HuddleSendPurpose | string | null;
};
export type PointsSummary = { total: number; rank: number | null; history: PointsEntry[] };
export type LeaderboardRow = { rank: number; user_id: string; username: string | null; avatar_url: string | null; total: number };
export type PointsHistoryPage = { entries: PointsEntry[]; next_before: string | null };

export const HUDDLE_SEND_PURPOSES = ['winner', 'best_answer', 'participation', 'speaker_thanks', 'bounty', 'other'] as const;
export type HuddleSendPurpose = (typeof HUDDLE_SEND_PURPOSES)[number];
export const HUDDLE_SEND_PURPOSE_LABELS: Record<HuddleSendPurpose, string> = {
  winner: 'Winner',
  best_answer: 'Best answer',
  participation: 'Participation',
  speaker_thanks: 'Speaker thanks',
  bounty: 'Bounty',
  other: 'Other',
};

/** Fired on `window` whenever the user's balance may have changed (AppShell and cards re-fetch). */
export const POINTS_CHANGED_EVENT = 'rendly:points-changed';

/** Largest single send; equals the server's TRANSFER_MAX_AMOUNT and the transfer_tokens RPC bound. */
export const TRANSFER_MAX_AMOUNT = 100_000;

/**
 * A fresh Idempotency-Key for one user action. Reuse the same key when retrying that action so a
 * lost response can never send twice (the server answers with the original result instead).
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (older browsers without randomUUID).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type TransferTokensInput = {
  to_user_id: string;
  amount: number;
  note?: string | null;
  conversation_id: string;
  /** Idempotency-Key for this send; generated when omitted. Pass the same key to retry. */
  idempotency_key?: string;
};
export type TransferTokensResult = { transfer_id: string; amount: number; balance: number };
export type HuddleSendTokensInput = {
  user_id: string;
  amount: number;
  purpose: HuddleSendPurpose;
  note?: string | null;
  /** Idempotency-Key for this send; generated when omitted. Pass the same key to retry. */
  idempotency_key?: string;
};
export type HuddleSendTokensResult = { transfer_id?: string; amount?: number; balance?: number };

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === 'string' && message ? message : fallback);
  }
  return data as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function getMyPoints(): Promise<PointsSummary> {
  const data = await readJson<Partial<PointsSummary>>(await authFetch('/api/points/me'), 'Could not load your Rendly Tokens');
  return {
    total: Number(data.total ?? 0),
    rank: typeof data.rank === 'number' ? data.rank : null,
    history: Array.isArray(data.history) ? data.history : [],
  };
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const data = await readJson<unknown>(await authFetch('/api/points/leaderboard'), 'Could not load rankings');
  return Array.isArray(data) ? (data as LeaderboardRow[]) : [];
}

/** Paged ledger, newest first. Pass `next_before` from the previous page to load older rows. */
export async function getPointsHistory(opts: { before?: string | null; limit?: number } = {}): Promise<PointsHistoryPage> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const data = await readJson<Partial<PointsHistoryPage> | PointsEntry[]>(
    await authFetch(`/api/points/history${qs ? `?${qs}` : ''}`),
    'Could not load your Rendly Tokens history'
  );
  if (Array.isArray(data)) return { entries: data, next_before: null };
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    next_before: typeof data?.next_before === 'string' ? data.next_before : null,
  };
}

/** Host mints free Rendly Tokens for a participant (huddle award; the host is not debited). */
export async function awardPoints(huddleId: string, userId: string, amount: number, note?: string): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(huddleId)}/award`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ user_id: userId, amount, note: note ?? null }),
  });
  await readJson<unknown>(res, 'Could not award Rendly Tokens');
}

/** Send Rendly Tokens from your balance to a chat partner. The Idempotency-Key becomes the transfer_id. */
export async function transferTokens(input: TransferTokensInput): Promise<TransferTokensResult> {
  const res = await authFetch('/api/tokens/transfer', {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Idempotency-Key': input.idempotency_key ?? newIdempotencyKey() },
    body: JSON.stringify({
      to_user_id: input.to_user_id,
      amount: input.amount,
      note: input.note ?? null,
      conversation_id: input.conversation_id,
    }),
  });
  const data = await readJson<Partial<TransferTokensResult>>(res, 'Could not send Rendly Tokens');
  return {
    transfer_id: String(data.transfer_id ?? ''),
    amount: Number(data.amount ?? input.amount),
    balance: Number(data.balance ?? 0),
  };
}

/** Host pays a participant from the host's own balance, with a purpose (note required for "other"). */
export async function sendHuddleTokens(huddleId: string, input: HuddleSendTokensInput): Promise<HuddleSendTokensResult> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(huddleId)}/send-tokens`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Idempotency-Key': input.idempotency_key ?? newIdempotencyKey() },
    body: JSON.stringify({
      user_id: input.user_id,
      amount: input.amount,
      purpose: input.purpose,
      note: input.note ?? null,
    }),
  });
  const data = await readJson<Partial<HuddleSendTokensResult> | null>(res, 'Could not send Rendly Tokens');
  return data ?? {};
}

/** Tell the shell (and any open cards) to re-fetch the balance. No-op during SSR. */
export function emitPointsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(POINTS_CHANGED_EVENT));
}

function handle(username?: string | null): string | null {
  const clean = (username ?? '').trim().replace(/^@/, '');
  return clean ? `@${clean}` : null;
}

export function huddleSendPurposeLabel(purpose?: string | null): string {
  if (purpose && (HUDDLE_SEND_PURPOSES as readonly string[]).includes(purpose)) {
    return HUDDLE_SEND_PURPOSE_LABELS[purpose as HuddleSendPurpose];
  }
  return HUDDLE_SEND_PURPOSE_LABELS.other;
}

/**
 * Human label for a ledger row, e.g. "Sent to @ana", "Huddle award from @host",
 * "Huddle send · Winner (to @ana)", "Intent purchase · Chess", "Royalty · Chess".
 * Falls back gracefully when the counterparty or intent name is missing.
 */
export function tokenEntryLabel(entry: PointsEntry): string {
  const credit = entry.amount >= 0;
  const who = handle(entry.counterparty_username);
  const kind = entry.category ?? entry.reason;

  switch (kind) {
    case 'signup':
    case 'signup_bonus':
      return 'Signup bonus';
    case 'transfer':
      if (credit) return who ? `Received from ${who}` : 'Received';
      return who ? `Sent to ${who}` : 'Sent';
    case 'huddle_award':
      return who ? `Huddle award from ${who}` : 'Huddle award';
    case 'huddle_send': {
      const base = `Huddle send · ${huddleSendPurposeLabel(entry.purpose)}`;
      if (!who) return base;
      return credit ? `${base} (from ${who})` : `${base} (to ${who})`;
    }
    case 'intent_purchase':
      return entry.intent_name ? `Intent purchase · ${entry.intent_name}` : 'Intent purchase';
    case 'intent_royalty':
      return entry.intent_name ? `Royalty · ${entry.intent_name}` : 'Royalty';
    default:
      return typeof entry.reason === 'string' && entry.reason ? entry.reason : 'Rendly Tokens';
  }
}

/** Legacy helper kept for callers that only have a reason string. */
export function pointsReasonLabel(reason: string): string {
  return tokenEntryLabel({ amount: 0, reason, note: null, huddle_id: null, created_at: '' });
}
