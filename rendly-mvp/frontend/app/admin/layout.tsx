import React from 'react';
import AdminNav from '@/components/admin/AdminNav';
import '@/components/admin/admin.css';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-shell">
      <AdminNav />
      <main className="adm-main">{children}</main>
    </div>
  );
}
