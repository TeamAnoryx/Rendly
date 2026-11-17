import { buildPeopleRows } from './peopleRows';
import type { Connection, ConnectionInvite } from '@/services/connectionsApi';

const conn = (id: string, at: string): Connection => ({ id, username: id, avatar_url: null, connected_at: at });
const inv = (id: string, direction: 'sent' | 'received', status = 'pending'): ConnectionInvite => ({
  id: `i-${id}`,
  from_user_id: 'a',
  to_user_id: 'b',
  status,
  created_at: '2026-11-10T00:00:00Z',
  direction,
  other_user: { id, username: id, avatar_url: null },
});

test('orders received invites, then sent invites, then connections newest first', () => {
  const rows = buildPeopleRows(
    [conn('old', '2026-01-01T00:00:00Z'), conn('new', '2026-11-01T00:00:00Z')],
    [inv('s', 'sent'), inv('r', 'received')],
  );
  expect(rows.map((r) => `${r.userId}:${r.status}`)).toEqual(['r:received', 's:sent', 'new:connected', 'old:connected']);
});

test('drops invites that are no longer pending and shows each person once', () => {
  const rows = buildPeopleRows([conn('x', '2026-11-01T00:00:00Z')], [inv('x', 'sent'), inv('y', 'received', 'accepted')]);
  expect(rows.map((r) => r.userId)).toEqual(['x']);
  expect(rows[0].status).toBe('sent');
});
