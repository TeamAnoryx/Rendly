import ModerationQueue from '@/components/admin/ModerationQueue';
import { AdminPageHead } from '@/components/admin/AdminTable';

export default function AdminModerationPage() {
  return (
    <div className="adm-page">
      <AdminPageHead title="Moderation" desc="Reports submitted by members, newest first." />
      <ModerationQueue />
    </div>
  );
}
