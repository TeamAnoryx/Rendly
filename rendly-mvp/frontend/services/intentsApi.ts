import { authFetch } from '@/lib/api';

/** Intents (preset chips, user-created custom intents and city "location" intents). */

export type IntentKind = 'preset' | 'custom' | 'location';
export type IntentVisibility = 'public' | 'private';
/** How the user got the intent; drives price and expiry. */
export type IntentSource = 'preset' | 'hot' | 'location' | 'nearby' | 'search' | 'created';

export type Intent = {
  id: string;
  name: string;
  slug: string;
  kind: IntentKind;
  visibility: IntentVisibility;
  creator_id: string | null;
  usage_count: number;
  active_users?: number;
  city?: string | null;
  country?: string | null;
  /** Present on search results: the viewer already has this intent active. */
  owned?: boolean;
};

export type MyIntent = Intent & {
  source: IntentSource;
  /** ISO date, or null when it never expires. */
  expires_at: string | null;
  /** The viewer created this intent. */
  is_mine: boolean;
};

export type NearbyUser = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  city: string | null;
  distance_km: number | null;
};

export type NearbyResult =
  | { status: 'ok'; user: NearbyUser; intents: Intent[] }
  | { status: 'no_location' }
  | { status: 'nobody' };

export type PurchaseIntentResult = { price: number; expires_at: string | null; balance: number };
export type CreateIntentInput = { name: string; visibility: IntentVisibility };
export type SetLocationInput = { lat: number; lng: number; city?: string | null };
export type HuddleStats = { hosted: number; public_joined: number };

/** Prices in Rendly Tokens. Must match the SQL `purchase_intent` table. */
export const INTENT_PRICES: Record<IntentSource, number> = {
  preset: 0,
  hot: 20,
  location: 20,
  nearby: 20,
  search: 10,
  created: 0,
};
export const INTENT_ROYALTY = 10;
export const INTENT_PURCHASE_DAYS = 28;
export const INTENT_PRIVATE_DAYS = 7;

/** Price the viewer would pay for `intent` via `source`; own intents are free. */
export function intentPrice(intent: Pick<Intent, 'kind'>, source: IntentSource, isMine: boolean): number {
  if (isMine || intent.kind === 'preset') return 0;
  return INTENT_PRICES[source] ?? 0;
}

/** "Free", "Yours" or "20 tokens" for a chip / result row. */
export function intentPriceLabel(intent: Pick<Intent, 'kind'>, source: IntentSource, isMine: boolean): string {
  if (isMine) return 'Yours';
  const price = intentPrice(intent, source, isMine);
  if (price === 0) return 'Free';
  return `${price} tokens`;
}

/** Whole days left before `expires_at`, or null when it never expires. */
export function intentDaysLeft(expiresAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

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

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const list = (data as { intents?: unknown } | null)?.intents;
  return Array.isArray(list) ? (list as T[]) : [];
}

export async function getMyIntents(): Promise<MyIntent[]> {
  const data = await readJson<unknown>(await authFetch('/api/intents/mine'), 'Could not load your intents');
  return asArray<MyIntent>(data);
}

export async function getHotIntents(): Promise<Intent[]> {
  const data = await readJson<unknown>(await authFetch('/api/intents/hot'), 'Could not load hot intents');
  return asArray<Intent>(data);
}

export async function getLocationIntents(): Promise<Intent[]> {
  const data = await readJson<unknown>(await authFetch('/api/intents/location'), 'Could not load location intents');
  return asArray<Intent>(data);
}

export async function getNearbyIntents(): Promise<NearbyResult> {
  const data = await readJson<{ status?: string; user?: NearbyUser | null; intents?: Intent[] } | null>(
    await authFetch('/api/intents/nearby'),
    'Could not look around you'
  );
  if (!data || data.status === 'no_location') return { status: 'no_location' };
  if (!data.user) return { status: 'nobody' };
  return { status: 'ok', user: data.user, intents: Array.isArray(data.intents) ? data.intents : [] };
}

export async function searchIntents(q: string, limit = 5): Promise<Intent[]> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const data = await readJson<unknown>(await authFetch(`/api/intents/search?${params.toString()}`), 'Could not search intents');
  return asArray<Intent>(data);
}

export async function purchaseIntent(intentId: string, source: IntentSource): Promise<PurchaseIntentResult> {
  const res = await authFetch('/api/intents/purchase', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ intent_id: intentId, source }),
  });
  const data = await readJson<Partial<PurchaseIntentResult>>(res, 'Could not add that intent');
  return {
    price: Number(data.price ?? 0),
    expires_at: typeof data.expires_at === 'string' ? data.expires_at : null,
    balance: Number(data.balance ?? 0),
  };
}

export async function createIntent(input: CreateIntentInput): Promise<MyIntent> {
  const res = await authFetch('/api/intents', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: input.name.trim(), visibility: input.visibility }),
  });
  const data = await readJson<{ intent?: MyIntent } | MyIntent>(res, 'Could not create that intent');
  const intent = (data as { intent?: MyIntent })?.intent ?? (data as MyIntent);
  return intent;
}

export async function removeMyIntent(intentId: string): Promise<void> {
  const res = await authFetch(`/api/intents/mine/${encodeURIComponent(intentId)}`, { method: 'DELETE' });
  await readJson<unknown>(res, 'Could not remove that intent');
}

/** Opt-in: store the browser's position on the profile (used only for Near By). */
export async function setMyLocation(input: SetLocationInput): Promise<void> {
  const res = await authFetch('/api/users/me/location', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ lat: input.lat, lng: input.lng, city: input.city ?? null }),
  });
  await readJson<unknown>(res, 'Could not save your location');
}

export async function clearMyLocation(): Promise<void> {
  const res = await authFetch('/api/users/me/location', { method: 'DELETE' });
  await readJson<unknown>(res, 'Could not clear your location');
}

export async function getMyHuddleStats(): Promise<HuddleStats> {
  const data = await readJson<Partial<HuddleStats>>(await authFetch('/api/users/me/huddle-stats'), 'Could not load huddle stats');
  return { hosted: Number(data.hosted ?? 0), public_joined: Number(data.public_joined ?? 0) };
}
