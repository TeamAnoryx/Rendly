'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listHuddles,
  createHuddle,
  joinHuddle,
  type HuddleListItem,
  type HuddlesListResponse,
  type CreateHuddlePayload,
  type CreateHuddleResponse,
} from '@/services/huddlesApi';

export type { HuddleListItem, CreateHuddlePayload, CreateHuddleResponse };

export function useHuddles(intent: string | null = null) {
  const [data, setData] = useState<HuddlesListResponse>({ trendy: [], live: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the first load (or a new filter) shows the skeleton; background refreshes keep the list.
  const loadedRef = useRef<string | null | undefined>(undefined);
  const fetchHuddles = useCallback(async () => {
    const first = loadedRef.current !== intent;
    if (first) setLoading(true);
    try {
      const result = await listHuddles('all', intent);
      setData(result);
      setError(null);
      loadedRef.current = intent;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load huddles');
      if (first) setData({ trendy: [], live: [] });
    } finally {
      if (first) setLoading(false);
    }
  }, [intent]);

  useEffect(() => {
    fetchHuddles();
    // Keep the lists live without a manual refresh.
    const timer = setInterval(() => {
      fetchHuddles();
    }, 15_000);
    return () => clearInterval(timer);
  }, [fetchHuddles]);

  const create = useCallback(
    async (payload: CreateHuddlePayload): Promise<CreateHuddleResponse> => {
      const result = await createHuddle(payload);
      await fetchHuddles();
      return result;
    },
    [fetchHuddles]
  );

  const join = useCallback(
    async (huddleId: string) => {
      const result = await joinHuddle(huddleId);
      await fetchHuddles();
      return result;
    },
    [fetchHuddles]
  );

  return {
    trendy: data.trendy,
    live: data.live,
    loading,
    error,
    refetch: fetchHuddles,
    createHuddle: create,
    joinHuddle: join,
  };
}
