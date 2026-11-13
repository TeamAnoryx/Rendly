import React from 'react';
import { RendlyLockup } from '@/components/brand/Brand';

/** Minimal brand header for standalone pages (the dashboard shell has its own topbar). */
export default function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="rd-topbar">
      <RendlyLockup />
      {children ? <div className="rd-topbar-actions">{children}</div> : null}
    </header>
  );
}
