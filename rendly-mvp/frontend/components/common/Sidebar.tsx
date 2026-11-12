import React from 'react';

/** Plain left column on the sidebar surface (the dashboard uses components/shell instead). */
export default function Sidebar({ children }: { children?: React.ReactNode }) {
  return (
    <aside className="flex h-full w-[232px] flex-col gap-1 border-r border-[var(--rd-border-faint)] bg-[var(--rd-bg-2)] p-3">
      {children}
    </aside>
  );
}
