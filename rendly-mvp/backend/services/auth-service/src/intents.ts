/**
 * Custom intents: rows in `intents`, held by users through `user_intents` (read through the
 * `active_user_intents` view so expired ones are ignored). Purchases and creation run inside
 * SQL RPCs (purchase_intent, create_intent) so debits, royalties and upserts are atomic.
 * Also the opt-in user location for "Near By" and the profile huddle stats.
 * Raw lat/lng of other users are never returned: only a distance bucket and city from the RPC.
 * creator_id is never returned either: the viewer sees is_mine instead.
 */

import { supabase } from "./supabase-users";
import { intentPrice, intentSlug, type IntentKind, type IntentSource, type IntentVisibility } from "./intents-rules";
import { isUuid } from "./huddle-rules";

const HOT_INTENTS_LIMIT = 10;
const SEARCH_DEFAULT_LIMIT = 5;
const SEARCH_MAX_LIMIT = 50;

export class IntentsStoreError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`[intents] ${operation} failed`);
    this.name = "IntentsStoreError";
    console.error(`[intents] ${operation} error:`, cause);
  }
}

function requireClient() {
  if (!supabase) throw new IntentsStoreError("connect", "Supabase is not configured");
  return supabase;
}

/** An intent as shown to users. Location coordinates of location intents are not exposed. */
export type IntentCard = {
  id: string;
  name: string;
  slug: string;
  kind: IntentKind;
  visibility: IntentVisibility;
  /** The viewer created this intent (computed server-side; creator ids are not exposed). */
  is_mine: boolean;
  city: string | null;
  usage_count: number;
  /** Tokens the viewer would pay to add it through this source. */
  price: number;
  /** The viewer already holds an active copy. */
  owned: boolean;
};

export type MyIntent = IntentCard & { source: IntentSource; expires_at: string | null; added_at: string };

const INTENT_COLUMNS = "id, name, slug, kind, visibility, creator_id, city, usage_count";

type IntentRow = {
  id: string;
  name: string;
  slug: string;
  kind: IntentKind;
  visibility?: IntentVisibility | null;
  /** Only on rows read from the intents table here; RPC rows carry is_mine / owned instead. */
  creator_id?: string | null;
  is_mine?: boolean | null;
  city?: string | null;
  usage_count?: number | null;
  owned?: boolean | null;
};

function toCard(row: IntentRow, viewerId: string, source: IntentSource, owned: boolean): IntentCard {
  const isOwner = row.is_mine === true || (row.creator_id != null && row.creator_id === viewerId);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    visibility: row.visibility ?? "public",
    is_mine: isOwner,
    city: row.city ?? null,
    usage_count: Number(row.usage_count ?? 0),
    price: intentPrice(row.kind, source, isOwner),
    owned,
  };
}

/** Ids of the intents the user holds right now (active rows only). */
async function fetchOwnedIntentIds(userId: string): Promise<Set<string>> {
  const client = requireClient();
  const { data, error } = await client.from("active_user_intents").select("intent_id").eq("user_id", userId);
  if (error) throw new IntentsStoreError("owned intents", error);
  return new Set(((data ?? []) as { intent_id: string }[]).map((r) => r.intent_id));
}

/** Intent rows by id, in one query. */
async function fetchIntentsById(ids: string[]): Promise<Map<string, IntentRow>> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (unique.length === 0) return new Map();
  const client = requireClient();
  const { data, error } = await client.from("intents").select(INTENT_COLUMNS).in("id", unique);
  if (error) throw new IntentsStoreError("intents by id", error);
  return new Map(((data ?? []) as IntentRow[]).map((r) => [r.id, r]));
}

/** Decorate RPC rows with price and owned for the viewer. */
async function toCards(rows: IntentRow[], viewerId: string, source: IntentSource): Promise<IntentCard[]> {
  if (rows.length === 0) return [];
  const owned = await fetchOwnedIntentIds(viewerId);
  return rows.map((r) => toCard(r, viewerId, source, owned.has(r.id)));
}

/** The user's active intents (presets, purchased and created), newest first. */
export async function getMyIntents(userId: string): Promise<MyIntent[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("active_user_intents")
    .select("intent_id, source, expires_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new IntentsStoreError("my intents", error);
  const holdings = (data ?? []) as { intent_id: string; source: IntentSource; expires_at: string | null; created_at: string }[];
  const intents = await fetchIntentsById(holdings.map((h) => h.intent_id));
  return holdings.flatMap((h) => {
    const row = intents.get(h.intent_id);
    if (!row) return [];
    return [{ ...toCard(row, userId, h.source, true), source: h.source, expires_at: h.expires_at, added_at: h.created_at }];
  });
}

/** Top public intents by usage (hot_intents RPC). */
export async function getHotIntents(viewerId: string, limit = HOT_INTENTS_LIMIT): Promise<IntentCard[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("hot_intents", { p_user_id: viewerId, p_limit: limit });
  if (error) throw new IntentsStoreError("hot intents", error);
  return toCards((data ?? []) as IntentRow[], viewerId, "hot");
}

/** City intents (location_intents RPC). */
export async function getLocationIntents(viewerId: string): Promise<IntentCard[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("location_intents");
  if (error) throw new IntentsStoreError("location intents", error);
  return toCards((data ?? []) as IntentRow[], viewerId, "location");
}

/** Coarse distance bucket from nearby_user_intents; the exact distance is never exposed. */
export const NEARBY_DISTANCE_BUCKETS = ["<5 km", "5-10 km", "10-25 km", "25-50 km", "50+ km"] as const;
export type NearbyDistance = (typeof NEARBY_DISTANCE_BUCKETS)[number];

function toNearbyDistance(raw: unknown): NearbyDistance {
  return (NEARBY_DISTANCE_BUCKETS as readonly unknown[]).includes(raw) ? (raw as NearbyDistance) : "50+ km";
}

export type NearbyUser = { id: string; username: string | null; avatar_url: string | null; city: string | null; distance: NearbyDistance };
export type NearbyIntents =
  | { status: "no_location" }
  | { status: "nobody_online"; user: null }
  | { status: "ok"; user: NearbyUser; intents: IntentCard[] };

/** The nearest online user and their intents (nearby_user_intents RPC). Needs the viewer's location. */
export async function getNearbyIntents(userId: string): Promise<NearbyIntents> {
  const client = requireClient();
  const { data, error } = await client.rpc("nearby_user_intents", { p_user_id: userId });
  if (error) throw new IntentsStoreError("nearby intents", error);
  const result = (data ?? {}) as { status?: string; user?: NearbyUser | null; intents?: IntentRow[] };
  if (result.status === "no_location") return { status: "no_location" };
  if (!result.user) return { status: "nobody_online", user: null };
  const { id, username, avatar_url, city, distance } = result.user;
  return {
    status: "ok",
    user: { id, username: username ?? null, avatar_url: avatar_url ?? null, city: city ?? null, distance: toNearbyDistance(distance) },
    intents: await toCards(result.intents ?? [], userId, "nearby"),
  };
}

/** Public intents whose slug starts with the query (search_intents RPC). Empty query returns nothing. */
export async function searchIntents(userId: string, q: string, limit = SEARCH_DEFAULT_LIMIT): Promise<IntentCard[]> {
  const prefix = intentSlug(q);
  if (!prefix) return [];
  const size = Math.min(Math.max(Math.floor(limit) || SEARCH_DEFAULT_LIMIT, 1), SEARCH_MAX_LIMIT);
  const client = requireClient();
  const { data, error } = await client.rpc("search_intents", { p_user_id: userId, p_q: prefix, p_limit: size });
  if (error) throw new IntentsStoreError("search intents", error);
  const rows = (data ?? []) as IntentRow[];
  return rows.map((r) => toCard(r, userId, "search", r.owned === true));
}

export type PurchaseFailure = "not_found" | "private" | "bad_source" | "bad_input" | "insufficient" | "duplicate";
export type PurchaseOutcome =
  | { status: "ok"; price: number; expires_at: string | null; balance: number }
  /** An unexpired copy is already held: nothing was charged. */
  | { status: "already_active"; expires_at: string | null }
  | { status: PurchaseFailure };
const PURCHASE_FAILURES: readonly PurchaseFailure[] = ["not_found", "private", "bad_source", "bad_input", "insufficient", "duplicate"];

/** Buy (or re-buy) an intent through a source (purchase_intent RPC). transferId is the idempotency key. */
export async function purchaseIntent(userId: string, intentId: string, source: IntentSource, transferId: string): Promise<PurchaseOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("purchase_intent", {
    p_user_id: userId,
    p_intent_id: intentId,
    p_source: source,
    p_transfer_id: transferId,
  });
  if (error) throw new IntentsStoreError("purchase", error);
  const result = (data ?? {}) as { status?: string; price?: number; expires_at?: string | null; balance?: number };
  if (result.status === "ok") {
    return { status: "ok", price: Number(result.price ?? 0), expires_at: result.expires_at ?? null, balance: Number(result.balance ?? 0) };
  }
  if (result.status === "already_active") return { status: "already_active", expires_at: result.expires_at ?? null };
  if (PURCHASE_FAILURES.includes(result.status as PurchaseFailure)) return { status: result.status as PurchaseFailure };
  throw new IntentsStoreError("purchase", `unexpected result: ${JSON.stringify(data)}`);
}

export type CreateIntentOutcome = { status: "ok"; intent: IntentCard } | { status: "taken" | "bad_name" | "limit_reached" };

/** Create a custom intent and hold it (create_intent RPC). Free; private ones last 7 days. */
export async function createIntent(userId: string, name: string, visibility: IntentVisibility): Promise<CreateIntentOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("create_intent", { p_user_id: userId, p_name: name, p_visibility: visibility });
  if (error) throw new IntentsStoreError("create", error);
  const result = (data ?? {}) as { status?: string; intent?: IntentRow };
  if (result.status === "ok" && result.intent) {
    return { status: "ok", intent: toCard(result.intent, userId, "created", true) };
  }
  if (result.status === "taken" || result.status === "bad_name" || result.status === "limit_reached") {
    return { status: result.status };
  }
  throw new IntentsStoreError("create", `unexpected result: ${JSON.stringify(data)}`);
}

/** Drop one intent from the user's list. Returns false when they did not hold it. */
export async function removeUserIntent(userId: string, intentId: string): Promise<boolean> {
  if (!isUuid(intentId)) return false;
  const client = requireClient();
  const { data, error } = await client.from("user_intents").delete().eq("user_id", userId).eq("intent_id", intentId).select("intent_id");
  if (error) throw new IntentsStoreError("remove", error);
  return (data ?? []).length > 0;
}

export type UserLocationView = { has_location: boolean; city: string | null; location_updated_at: string | null };

export type SetLocationOutcome = { status: "ok"; view: UserLocationView } | { status: "too_soon"; retry_after_seconds: number };

/**
 * Store the user's opt-in location through set_user_location: coordinates rounded to ~1 km,
 * Near By discovery turned on, at most one update per 10 minutes (too_soon). Only the city and
 * timestamp are echoed back.
 */
export async function setUserLocation(userId: string, input: { lat: number; lng: number; city: string | null }): Promise<SetLocationOutcome> {
  const client = requireClient();
  const { data, error } = await client.rpc("set_user_location", {
    p_user_id: userId,
    p_lat: input.lat,
    p_lng: input.lng,
    p_city: input.city,
  });
  if (error) throw new IntentsStoreError("set location", error);
  const result = (data ?? {}) as { status?: string; city?: string | null; location_updated_at?: string; retry_after_seconds?: number };
  if (result.status === "ok") {
    return {
      status: "ok",
      view: { has_location: true, city: result.city ?? null, location_updated_at: result.location_updated_at ?? null },
    };
  }
  if (result.status === "too_soon") {
    return { status: "too_soon", retry_after_seconds: Math.max(1, Number(result.retry_after_seconds ?? 600)) };
  }
  throw new IntentsStoreError("set location", `unexpected result: ${JSON.stringify(data)}`);
}

/**
 * Forget the user's location and leave Near By. location_updated_at is kept on purpose: it is the
 * rate-limit clock for set_user_location, so clear + set cannot bypass the 10-minute limit.
 */
export async function clearUserLocation(userId: string): Promise<UserLocationView> {
  const client = requireClient();
  const { error } = await client
    .from("users")
    .update({ lat: null, lng: null, city: null, discoverable_nearby: false })
    .eq("id", userId);
  if (error) throw new IntentsStoreError("clear location", error);
  return { has_location: false, city: null, location_updated_at: null };
}

export type ProfileHuddleStats = { hosted: number; public_joined: number };

/** Hosted and public-joined huddle counts for the profile card (profile_huddle_stats RPC). */
export async function getProfileHuddleStats(userId: string): Promise<ProfileHuddleStats> {
  const client = requireClient();
  const { data, error } = await client.rpc("profile_huddle_stats", { p_user_id: userId });
  if (error) throw new IntentsStoreError("huddle stats", error);
  const row = (data ?? {}) as { hosted?: number; public_joined?: number };
  return { hosted: Number(row.hosted ?? 0), public_joined: Number(row.public_joined ?? 0) };
}

/**
 * Mirror users.selected_intents into user_intents: preset rows the user no longer selects are
 * removed, the selected ones are upserted with source 'preset' and no expiry. Only presets
 * (kind 'preset') are touched; purchased and created intents are left alone.
 */
export async function syncPresetIntents(userId: string, names: string[]): Promise<void> {
  const client = requireClient();
  const wanted = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const { data, error } = await client.from("intents").select("id, name").eq("kind", "preset").in("name", wanted.length ? wanted : [""]);
  if (error) throw new IntentsStoreError("preset lookup", error);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);

  let remove = client.from("user_intents").delete().eq("user_id", userId).eq("source", "preset");
  if (ids.length > 0) remove = remove.not("intent_id", "in", `(${ids.join(",")})`);
  const { error: removeError } = await remove;
  if (removeError) throw new IntentsStoreError("preset prune", removeError);

  if (ids.length === 0) return;
  const { error: upsertError } = await client
    .from("user_intents")
    .upsert(
      ids.map((intent_id) => ({ user_id: userId, intent_id, source: "preset", expires_at: null })),
      { onConflict: "user_id,intent_id" }
    );
  if (upsertError) throw new IntentsStoreError("preset sync", upsertError);
}
