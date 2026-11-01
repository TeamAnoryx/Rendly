'use client';

import React, { useEffect, useState } from 'react';
import { DashboardSidebarProvider } from './DashboardSidebarContext';
import { CurrentUserProvider } from '@/context/CurrentUserContext';
import { CallProvider } from '@/context/CallContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { AppShell } from '@/components/shell/AppShell';
import { IncomingCallOverlay } from './chat/IncomingCallOverlay';
import './dashboard.css';

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  // Kept for DashboardLink, which closes the old sidebar before leaving the dashboard.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* Drop ?welcome=1 after profile setup; the welcome notification comes from the server. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') !== '1') return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);

  return (
    <DashboardSidebarProvider sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}>
      <AppShell>{children}</AppShell>
    </DashboardSidebarProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      <NotificationsProvider>
        <CallProvider>
          <DashboardLayoutInner>{children}</DashboardLayoutInner>
          <IncomingCallOverlay />
        </CallProvider>
      </NotificationsProvider>
    </CurrentUserProvider>
  );
}
