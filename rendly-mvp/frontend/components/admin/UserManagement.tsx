import React from 'react';
import { AdminTable, AdminId, AdminStatus, type AdminColumn } from './AdminTable';

export type AdminUserRow = {
  id: string;
  username: string | null;
  email: string | null;
  status: 'active' | 'suspended' | 'pending';
  points: number;
  joinedAt: string;
};

const TONE = { active: 'success', suspended: 'danger', pending: 'warning' } as const;

const COLUMNS: AdminColumn<AdminUserRow>[] = [
  { key: 'id', header: 'ID', render: (r) => <AdminId id={r.id} /> },
  { key: 'user', header: 'User', render: (r) => (r.username ? `@${r.username}` : '—') },
  { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
  { key: 'status', header: 'Status', render: (r) => <AdminStatus tone={TONE[r.status]}>{r.status}</AdminStatus> },
  { key: 'points', header: 'Points', numeric: true, render: (r) => r.points.toLocaleString('en-IN') },
  { key: 'joined', header: 'Joined', render: (r) => new Date(r.joinedAt).toLocaleDateString() },
];

export default function UserManagement({ users = [] }: { users?: AdminUserRow[] }) {
  return (
    <AdminTable
      caption="Users"
      columns={COLUMNS}
      rows={users}
      rowKey={(r) => r.id}
      emptyTitle="No users to show"
      emptyHint="The admin users endpoint is not connected yet."
    />
  );
}
