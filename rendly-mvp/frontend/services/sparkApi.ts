import { authFetch } from '@/lib/api';

export type SparkMode = 'text' | 'video';
export type SparkIntent = 'Light chat' | 'Brainstorm' | 'Motivation' | 'Collaborate';

export type SparkPartner = { id: string; username: string | null; avatar_url: string | null };

export type SparkView =
  | { status: 'idle' }
  | { status: 'waiting'; queue_id: string; mode: SparkMode; intent: SparkIntent; waited_seconds: number }
  | {
      status: 'matched';
      mode: SparkMode;
      intent: SparkIntent;
      conversation_id: string;
      initiator: boolean;
      partner: SparkPartner;
    };

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

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = await readJson(res);
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === 'string' && message ? message : fallback);
  }
  return data as T;
}

/** Join the Spark queue for a mode and intent. Returns the current state (waiting or matched). */
export async function joinSparkQueue(mode: SparkMode, intent: SparkIntent): Promise<SparkView> {
  const res = await authFetch('/api/match/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, intent }),
  });
  return parseOrThrow<SparkView>(res, 'Could not join the match queue');
}

export async function getSparkStatus(): Promise<SparkView> {
  const res = await authFetch('/api/match/status');
  return parseOrThrow<SparkView>(res, 'Could not read match status');
}

export async function leaveSparkQueue(): Promise<{ cancelled: number }> {
  const res = await authFetch('/api/match/queue', { method: 'DELETE' });
  return parseOrThrow<{ cancelled: number }>(res, 'Could not leave the match queue');
}
