import { authFetch } from '@/lib/api';

export type UserCard = { id: string; username: string | null; avatar_url: string | null };

const cache = new Map<string, Promise<UserCard | null>>();

/** Name and avatar for a user id. Cached for the session; null when unknown. */
export function getUserCard(id: string): Promise<UserCard | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = authFetch(`/api/users/${encodeURIComponent(id)}/card`)
    .then(async (res) => {
      if (!res.ok) {
        console.warn(`[users] card ${id} unavailable (${res.status})`);
        return null;
      }
      return (await res.json()) as UserCard;
    })
    .catch((err) => {
      console.warn('[users] card lookup failed', err);
      return null;
    });
  cache.set(id, p);
  p.then((v) => {
    if (!v) cache.delete(id); // retry later on failure
  });
  return p;
}

/** The other participant of a whisper conversation id (whisper_<a>_<b>). */
export function otherPartyOf(conversationId: string | null, me: string | null | undefined): string | null {
  if (!conversationId || !me || !conversationId.startsWith('whisper_')) return null;
  const parts = conversationId.split('_');
  if (parts.length !== 3) return null;
  if (parts[1] === me) return parts[2];
  if (parts[2] === me) return parts[1];
  return null;
}
