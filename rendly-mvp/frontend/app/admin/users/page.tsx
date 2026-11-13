import UserManagement from '@/components/admin/UserManagement';
import { AdminPageHead } from '@/components/admin/AdminTable';

export default function AdminUsersPage() {
  return (
    <div className="adm-page">
      <AdminPageHead title="Users" desc="Every account on Rendly." />
      <UserManagement />
    </div>
  );
}
