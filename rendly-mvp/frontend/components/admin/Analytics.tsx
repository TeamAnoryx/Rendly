import React from 'react';
import { AdminStats, AdminTable, type AdminColumn } from './AdminTable';

export type AnalyticsRow = { metric: string; today: number; week: number; month: number };

const COLUMNS: AdminColumn<AnalyticsRow>[] = [
  { key: 'metric', header: 'Metric', render: (r) => r.metric },
  { key: 'today', header: 'Today', numeric: true, render: (r) => r.today.toLocaleString('en-IN') },
  { key: 'week', header: '7 days', numeric: true, render: (r) => r.week.toLocaleString('en-IN') },
  { key: 'month', header: '30 days', numeric: true, render: (r) => r.month.toLocaleString('en-IN') },
];

export default function Analytics({ rows = [] }: { rows?: AnalyticsRow[] }) {
  return (
    <>
      <AdminStats
        items={[
          { label: 'Daily active', value: '—' },
          { label: 'Matches today', value: '—' },
          { label: 'Live huddles', value: '—' },
          { label: 'Messages today', value: '—' },
        ]}
      />
      <AdminTable
        caption="Analytics"
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.metric}
        emptyTitle="No metrics yet"
        emptyHint="Analytics will populate once the reporting endpoint is connected."
      />
    </>
  );
}
