import type { Connection, ConnectionInvite } from '@/services/connectionsApi';

export type PersonStatus = 'connected' | 'received' | 'sent';

export type PersonRow = {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  status: PersonStatus;
  /** When they connected, or when the invite was sent (ISO). */
  at: string;
  invite?: ConnectionInvite;
};

const ORDER: Record<PersonStatus, number> = { received: 0, sent: 1, connected: 2 };

/**
 * One People list: pending invites (received first, then sent) and connections, newest first
 * within each group. Each person appears once; a pending invite wins over a stale connection row.
 */
export function buildPeopleRows(connections: readonly Connection[], invites: readonly ConnectionInvite[]): PersonRow[] {
  const rows: PersonRow[] = [];
  const seen = new Set<string>();
  for (const inv of invites) {
    if (inv.status !== 'pending' || seen.has(inv.other_user.id)) continue;
    seen.add(inv.other_user.id);
    rows.push({
      userId: inv.other_user.id,
      username: inv.other_user.username,
      avatarUrl: inv.other_user.avatar_url,
      status: inv.direction === 'received' ? 'received' : 'sent',
      at: inv.created_at,
      invite: inv,
    });
  }
  for (const c of connections) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ userId: c.id, username: c.username, avatarUrl: c.avatar_url, status: 'connected', at: c.connected_at });
  }
  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at.localeCompare(a.at));
}
