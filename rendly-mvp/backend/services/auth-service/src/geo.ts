/**
 * Geocoding proxy to Nominatim (OpenStreetMap). The browser never talks to Nominatim, so
 * the user's IP never reaches a third party. Follows the Nominatim usage policy: a generic
 * identifying User-Agent, at most one upstream request every 1.1 s across the process, and
 * a 10-minute in-memory cache. Queries are never logged.
 */

import axios from "axios";
import {
  mapReverseResponse,
  mapSearchResponse,
  reverseCacheKey,
  searchCacheKey,
  type GeoReverseResult,
  type GeoSearchResult,
} from "./geo-rules";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Rendly/1.0 (geocoding proxy)";
const UPSTREAM_TIMEOUT_MS = 8000;
const MIN_GAP_MS = 1100;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Requests waiting for an upstream slot beyond this are refused instead of piling up. */
const MAX_PENDING = 20;

/** Nominatim failed, timed out or the proxy is saturated. */
export class GeoUnavailableError extends Error {
  constructor(reason: string) {
    super(`[geo] upstream unavailable: ${reason}`);
    this.name = "GeoUnavailableError";
  }
}

type CacheEntry = { value: unknown; expires: number };
const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.delete(key);
  while (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

let lastCallAt = 0;
let chain: Promise<unknown> = Promise.resolve();
let pending = 0;

/** Run fn after every earlier upstream call, at least MIN_GAP_MS after the previous one started. */
function enqueueUpstream<T>(fn: () => Promise<T>): Promise<T> {
  if (pending >= MAX_PENDING) return Promise.reject(new GeoUnavailableError("queue full"));
  pending += 1;
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined).finally(() => {
    pending -= 1;
  });
  return run;
}

async function upstream(path: string, params: Record<string, string | number>, lang: string): Promise<unknown> {
  try {
    const res = await enqueueUpstream(() =>
      axios.get(`${NOMINATIM_BASE}${path}`, {
        params,
        timeout: UPSTREAM_TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": lang, Accept: "application/json" },
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        responseType: "json",
        validateStatus: (s) => s === 200,
      })
    );
    return res.data;
  } catch (err) {
    if (err instanceof GeoUnavailableError) throw err;
    const status = axios.isAxiosError(err) ? err.response?.status ?? err.code ?? "network" : "unknown";
    // Status only: never the query or coordinates.
    throw new GeoUnavailableError(String(status));
  }
}

/** Up to 5 places matching an already normalised query. */
export async function geoSearch(query: string, lang: string): Promise<GeoSearchResult[]> {
  const key = searchCacheKey(query, lang);
  const cached = cacheGet<GeoSearchResult[]>(key);
  if (cached) return cached;
  const data = await upstream("/search", { q: query, format: "jsonv2", limit: 5, addressdetails: 1 }, lang);
  const results = mapSearchResponse(data);
  cacheSet(key, results);
  return results;
}

/** The address at already rounded coordinates, or null when Nominatim finds nothing. */
export async function geoReverse(lat: number, lng: number, lang: string): Promise<GeoReverseResult | null> {
  const key = reverseCacheKey(lat, lng, lang);
  const cached = cacheGet<GeoReverseResult | null>(key);
  if (cached !== undefined) return cached;
  const data = await upstream("/reverse", { lat, lon: lng, format: "jsonv2", zoom: 10 }, lang);
  const result = mapReverseResponse(data);
  cacheSet(key, result);
  return result;
}
