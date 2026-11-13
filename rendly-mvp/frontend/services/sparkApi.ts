import { authFetch } from '@/lib/api';

export type SparkMode = 'text' | 'video';

/** Built-in intents shown first in the Spark chooser. Any active intent (custom or purchased) is also valid. */
export const SPARK_PRESET_INTENTS = ['Light chat', 'Brainstorm', 'Motivation', 'Collaborate'] as const;
export type SparkPresetIntent = (typeof SPARK_PRESET_INTENTS)[number];
/** Free-text intent name (2..40 chars, validated server-side). */
export type SparkIntent = string;

/** Seconds after which the backend widens the match to any shared active intent. */
export const SPARK_FALLBACK_AFTER_SECONDS = 60;

export type SparkPartner = { id: string; username: string | null; avatar_url: string | null };

export type SparkView =
  | { status: 'idle' }
  | {
      status: 'waiting';
      queue_id: string;
      mode: SparkMode;
      intent: SparkIntent;
      waited_seconds: number;
      /** True once the search has widened to any shared active intent. */
      fallback?: boolean;
    }
  | {
      status: 'matched';
      mode: SparkMode;
      intent: SparkIntent;
      conversation_id: string;
      initiator: boolean;
      partner: SparkPartner;
      /** True when the pair was made on a shared intent rather than the exact one requested. */
      fallback?: boolean;
      waited_seconds?: number;
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
