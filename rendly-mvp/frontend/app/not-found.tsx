import Link from 'next/link';
import { RendlyMark } from '@/components/brand/Brand';

/** 404: brand mark, a big mono code, one line, one way home. */
export default function NotFound() {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[var(--rd-bg)] px-6 text-center text-[var(--rd-text)]">
      <div className="rd-grid-overlay pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="relative flex flex-col items-center" style={{ animation: 'rd-page-in 0.6s var(--rd-ease) both' }}>
        <RendlyMark className="mb-10 h-8 w-auto text-[var(--rd-muted)]" title="Rendly" />
        <p
          className="rd-gradient-text select-none font-mono font-medium leading-none tracking-[-0.06em] tabular-nums"
          style={{ fontSize: 'clamp(5.5rem, 22vw, 11rem)' }}
          aria-hidden
        >
          404
        </p>
        <h1 className="mt-6 text-[0.9375rem] font-medium text-[var(--rd-text-2)]">
          This page does not exist, or it has moved.
        </h1>
        <Link href="/" className="rd-btn rd-btn--primary mt-8">
          Back to home
        </Link>
        <Link href="/dashboard" className="rd-btn rd-btn--ghost rd-btn--sm mt-2">
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
