import ModerationQueue from '@/components/admin/ModerationQueue';
import { AdminPageHead, AdminStats } from '@/components/admin/AdminTable';

export default function AdminDashboardPage() {
  return (
    <div className="adm-page">
      <AdminPageHead title="Overview" desc="Health of the platform at a glance." />
      <AdminStats
        items={[
          { label: 'Total users', value: '—' },
          { label: 'Active today', value: '—' },
          { label: 'Open reports', value: '—' },
          { label: 'Live huddles', value: '—' },
        ]}
      />
      <h2 className="rd-h2">Recent reports</h2>
      <ModerationQueue />
    </div>
  );
}
