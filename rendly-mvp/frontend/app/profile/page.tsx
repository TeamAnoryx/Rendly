'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RendlyMark } from '@/components/brand/Brand';

/** Legacy route: forwards to /profile-setup, showing the brand mark while it does. */
export default function ProfilePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/profile-setup');
  }, [router]);
  return (
    <main
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-[var(--rd-bg)] text-[var(--rd-muted)]"
      aria-busy="true"
    >
      <RendlyMark className="h-8 w-auto" title="Rendly" />
      <span className="rd-spinner" role="status" aria-label="Redirecting" />
    </main>
  );
}
