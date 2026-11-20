import React from 'react';
import type { Metadata } from 'next';
import AdminGate from '@/components/admin/console/AdminGate';
import '@/components/admin/admin.css';
import '@/components/admin/console/console.css';

export const metadata: Metadata = {
  title: 'Rendly Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
