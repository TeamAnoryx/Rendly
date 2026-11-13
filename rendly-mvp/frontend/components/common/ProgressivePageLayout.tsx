'use client';

import React, { Suspense } from 'react';
import {
  HeaderSkeleton,
  SidebarSkeleton,
  CardSkeleton,
} from './SkeletonLoader';

/**
 * ProgressivePageLayout: each section in Suspense with skeleton fallback.
 * Renders skeleton at 0ms, then actual content when ready. No blank page.
 */
type ProgressivePageLayoutProps = {
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  content?: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional custom skeleton for main content */
  contentSkeleton?: React.ReactNode;
};

const DefaultContentSkeleton = () => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <CardSkeleton />
    <CardSkeleton />
    <CardSkeleton />
  </div>
);

export default function ProgressivePageLayout({
  header,
  sidebar,
  content,
  footer,
  contentSkeleton,
}: ProgressivePageLayoutProps) {
  const contentFallback = contentSkeleton ?? <DefaultContentSkeleton />;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--rd-bg)] text-[var(--rd-text)]">
      {header !== undefined && (
        <header className="shrink-0">
          <Suspense fallback={<HeaderSkeleton />}>{header}</Suspense>
        </header>
      )}

      <div className="flex flex-1">
        {sidebar !== undefined && (
          <aside className="shrink-0">
            <Suspense fallback={<SidebarSkeleton />}>{sidebar}</Suspense>
          </aside>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">
          {content !== undefined ? (
            <Suspense fallback={contentFallback}>{content}</Suspense>
          ) : (
            contentFallback
          )}
        </main>
      </div>

      {footer !== undefined && (
        <footer className="shrink-0">
          <Suspense fallback={<div className="h-16 border-t border-[var(--rd-border-faint)]" />}>
            {footer}
          </Suspense>
        </footer>
      )}
    </div>
  );
}
