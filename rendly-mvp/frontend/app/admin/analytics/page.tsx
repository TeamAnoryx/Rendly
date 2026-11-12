import Analytics from '@/components/admin/Analytics';
import { AdminPageHead } from '@/components/admin/AdminTable';

export default function AdminAnalyticsPage() {
  return (
    <div className="adm-page">
      <AdminPageHead title="Analytics" desc="Activity across matches, huddles and chat." />
      <Analytics />
    </div>
  );
}
