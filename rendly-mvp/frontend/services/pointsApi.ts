import { authFetch } from '@/lib/api';

export type PointsEntry = { amount: number; reason: string; note: string | null; huddle_id: string | null; created_at: string };
export type PointsSummary = { total: number; rank: number | null; history: PointsEntry[] };
export type LeaderboardRow = { rank: number; user_id: string; username: string | null; avatar_url: string | null; total: number };

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

export async function getMyPoints(): Promise<PointsSummary> {
  const data = await readJson<Partial<PointsSummary>>(await authFetch('/api/points/me'), 'Could not load points');
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

export async function awardPoints(huddleId: string, userId: string, amount: number, note?: string): Promise<void> {
  const res = await authFetch(`/api/huddles/${encodeURIComponent(huddleId)}/award`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, amount, note: note ?? null }),
  });
  await readJson<unknown>(res, 'Could not award points');
}

export function pointsReasonLabel(reason: string): string {
  if (reason === 'signup_bonus') return 'Signup bonus';
  if (reason === 'huddle_award') return 'Huddle award';
  return reason;
}
