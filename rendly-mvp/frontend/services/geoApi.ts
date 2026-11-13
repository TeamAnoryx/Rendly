import { authFetch } from '@/lib/api';

/** Address search and reverse geocoding, proxied by the backend (/api/geo/*). */

export type GeoSearchResult = {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
};

export type GeoReverseResult = {
  label: string;
  city: string | null;
  country: string | null;
};

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

export async function searchAddress(q: string): Promise<{ results: GeoSearchResult[] }> {
  const res = await authFetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
  const data = await readJson<{ results?: unknown } | null>(res, 'Could not search that address');
  return { results: Array.isArray(data?.results) ? (data.results as GeoSearchResult[]) : [] };
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoReverseResult> {
  const res = await authFetch(
    `/api/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`
  );
  const data = await readJson<Partial<GeoReverseResult> | null>(res, 'Could not look up that location');
  return {
    label: typeof data?.label === 'string' ? data.label : '',
    city: typeof data?.city === 'string' ? data.city : null,
    country: typeof data?.country === 'string' ? data.country : null,
  };
}
