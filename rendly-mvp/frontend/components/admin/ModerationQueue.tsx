import React from 'react';
import { AdminTable, AdminId, AdminStatus, type AdminColumn } from './AdminTable';

export type ModerationReportRow = {
  id: string;
  type: 'harassment' | 'fraud' | 'spam' | 'other';
  target: string | null;
  reporter: string | null;
  status: 'open' | 'reviewing' | 'resolved';
  createdAt: string;
};

const TONE = { open: 'danger', reviewing: 'warning', resolved: 'success' } as const;

const COLUMNS: AdminColumn<ModerationReportRow>[] = [
  { key: 'id', header: 'Report', render: (r) => <AdminId id={r.id} /> },
  { key: 'type', header: 'Type', render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.type}</span> },
  { key: 'target', header: 'Target', render: (r) => (r.target ? `@${r.target}` : '—') },
  { key: 'reporter', header: 'Reporter', render: (r) => (r.reporter ? `@${r.reporter}` : '—') },
  { key: 'status', header: 'Status', render: (r) => <AdminStatus tone={TONE[r.status]}>{r.status}</AdminStatus> },
  { key: 'created', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleString() },
];

export default function ModerationQueue({ reports = [] }: { reports?: ModerationReportRow[] }) {
  return (
    <AdminTable
      caption="Moderation queue"
      columns={COLUMNS}
      rows={reports}
      rowKey={(r) => r.id}
      emptyTitle="Queue is clear"
      emptyHint="New reports from Settings → Report will appear here once the moderation endpoint is connected."
    />
  );
}
