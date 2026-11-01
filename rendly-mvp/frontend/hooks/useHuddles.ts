'use client';

import { useCallback, useEffect, useState } from 'react';
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

export function useHuddles() {
  const [data, setData] = useState<HuddlesListResponse>({ trendy: [], live: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHuddles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listHuddles('all');
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load huddles');
      setData({ trendy: [], live: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHuddles();
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
