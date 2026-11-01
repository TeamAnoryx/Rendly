import { authFetch } from '@/lib/api';

export type HuddleType = 'public' | 'private' | 'instant';

export type HuddleListItem = {
  id: string;
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  is_active: boolean;
  scheduled_at: string | null;
  duration_minutes: number | null;
  invite_code: string | null;
  created_at: string;
  participants_count: number;
};

export type HuddlesListResponse = {
  trendy: HuddleListItem[];
  live: HuddleListItem[];
};

export type HuddleDetail = HuddleListItem & {
  invite_url: string;
  created_by: string;
  started_at: string | null;
  ended_at: string | null;
  settings: Record<string, unknown>;
};

export type CreateHuddlePayload = {
  title: string;
  description?: string | null;
  max_participants: 10 | 15 | 20 | 50;
  type?: HuddleType;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  settings?: Record<string, unknown>;
};

export type CreateHuddleResponse = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  is_active: boolean;
  scheduled_at: string | null;
  duration_minutes: number | null;
  invite_code: string | null;
  created_at: string;
  invite_url: string;
};

export async function listHuddles(category: 'trendy' | 'live' | 'all' = 'all'): Promise<HuddlesListResponse> {
  const res = await authFetch(`/api/huddles?category=${encodeURIComponent(category)}`);
  if (!res.ok) throw new Error('Failed to list huddles');
  const data = await res.json();
  return {
    trendy: Array.isArray(data.trendy) ? data.trendy : [],
    live: Array.isArray(data.live) ? data.live : [],
  };
}

export async function listActiveHuddles(): Promise<HuddleListItem[]> {
  const res = await authFetch('/api/huddles/active');
  if (!res.ok) throw new Error('Failed to list active huddles');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createHuddle(payload: CreateHuddlePayload): Promise<CreateHuddleResponse> {
  const res = await authFetch('/api/huddles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: payload.title,
      description: payload.description ?? null,
      max_participants: payload.max_participants,
      type: payload.type ?? 'public',
      scheduled_at: payload.scheduled_at ?? null,
      duration_minutes: payload.duration_minutes ?? null,
      settings: payload.settings ?? {},
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data?.message as string) || 'Failed to create huddle');
  return data;
}

export async function getHuddle(id: string): Promise<HuddleDetail> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error('Failed to get huddle');
  return res.json();
}

export async function joinHuddle(id: string): Promise<{ huddle_id: string; user_id: string; joined_at: string }> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(id)}/join`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error((data?.message as string) || 'Failed to join huddle');
  return data;
}
