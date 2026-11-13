'use client';

import React from 'react';

/**
 * Loading skeletons. Monochrome shimmer (`.rd-skeleton`) on hairline surfaces, CSS only.
 * The shimmer stops under prefers-reduced-motion via the global rule in rendly-theme.css.
 */
function SkeletonBase({
  className = '',
  children,
  style,
}: {
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`rd-skeleton ${className}`} style={style} aria-hidden>
      {children}
    </div>
  );
}

const HAIRLINE: React.CSSProperties = {
  border: '1px solid var(--rd-border)',
  background: 'var(--rd-panel)',
  borderRadius: 'var(--rd-radius)',
};

/** Text lines. */
export function TextSkeleton({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBase key={i} style={{ height: 10, width: i === lines - 1 && lines > 1 ? '70%' : '100%' }} />
      ))}
    </div>
  );
}

/** Card with a title and three lines. */
export function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`p-4 ${className}`} style={HAIRLINE}>
      <SkeletonBase className="mb-3" style={{ height: 12, width: '55%' }} />
      <TextSkeleton lines={3} className="mt-2" />
    </div>
  );
}

/** Image placeholder. */
export function ImageSkeleton({ className = '', aspectRatio = 'aspect-video' }: { className?: string; aspectRatio?: string }) {
  return <SkeletonBase className={`${aspectRatio} w-full ${className}`} />;
}

/** Round avatar placeholder. */
export function AvatarSkeleton({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const px = size === 'sm' ? 24 : size === 'lg' ? 48 : 32;
  return <SkeletonBase className={className} style={{ width: px, height: px, borderRadius: '50%', flex: 'none' }} />;
}

/** Button placeholder. */
export function ButtonSkeleton({ className = '', width = 'w-24' }: { className?: string; width?: string }) {
  return <SkeletonBase className={`${width} ${className}`} style={{ height: 32 }} />;
}

/** Top bar placeholder (52px, hairline bottom). */
export function HeaderSkeleton({ className = '' }: { className?: string }) {
  return (
    <header
      className={`flex items-center justify-between px-5 ${className}`}
      style={{ height: 52, borderBottom: '1px solid var(--rd-border-faint)' }}
    >
      <SkeletonBase style={{ height: 12, width: 120 }} />
      <div className="flex items-center gap-2">
        <SkeletonBase style={{ height: 28, width: 64, borderRadius: 999 }} />
        <AvatarSkeleton size="sm" />
      </div>
    </header>
  );
}

/** Sidebar nav placeholder. */
export function SidebarSkeleton({ className = '' }: { className?: string }) {
  return (
    <aside className={`w-56 space-y-1 p-3 ${className}`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonBase key={i} style={{ height: 28 }} />
      ))}
    </aside>
  );
}

/** Content inside the app shell: title, stat strip, two list panels. Used by dashboard/loading.tsx. */
export function DashboardSkeleton() {
  return (
    <div className="rd-page" aria-busy="true" aria-label="Loading">
      <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="flex items-end justify-between gap-4" style={{ paddingTop: 4 }}>
          <div className="flex flex-col gap-2" style={{ flex: 1 }}>
            <SkeletonBase style={{ height: 22, width: 'min(320px, 70%)' }} />
            <SkeletonBase style={{ height: 10, width: 'min(220px, 50%)' }} />
          </div>
          <SkeletonBase className="hidden sm:block" style={{ height: 32, width: 120 }} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ ...HAIRLINE, overflow: 'hidden' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 p-4">
              <SkeletonBase style={{ height: 10, width: '45%' }} />
              <SkeletonBase style={{ height: 20, width: '35%' }} />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((p) => (
            <div key={p} style={{ ...HAIRLINE, overflow: 'hidden' }}>
              <div style={{ height: 48, borderBottom: '1px solid var(--rd-border-faint)' }} className="flex items-center px-4">
                <SkeletonBase style={{ height: 10, width: 96 }} />
              </div>
              {[0, 1, 2].map((r) => (
                <div
                  key={r}
                  className="flex items-center gap-3 px-4"
                  style={{ height: 56, borderTop: r ? '1px solid var(--rd-border-faint)' : undefined }}
                >
                  <AvatarSkeleton />
                  <SkeletonBase style={{ height: 10, width: `${60 - r * 12}%` }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Full-page skeleton (outside the app shell): top bar + content.
 * Instant fallback in loading.tsx so the user never sees a blank page.
 */
export function PageSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`min-h-screen ${className}`} style={{ background: 'var(--rd-bg)' }} aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <main className="p-4 md:p-6">
        <div className="mx-auto max-w-6xl">
          <SkeletonBase className="mb-6" style={{ height: 20, width: 192 }} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}

const SkeletonLoader = {
  TextSkeleton,
  CardSkeleton,
  ImageSkeleton,
  AvatarSkeleton,
  ButtonSkeleton,
  HeaderSkeleton,
  SidebarSkeleton,
  DashboardSkeleton,
  PageSkeleton,
};

export default SkeletonLoader;
