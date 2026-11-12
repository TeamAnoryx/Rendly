import React from 'react';
import { RendlyMark, RendlyWordmark } from '@/components/brand/Brand';

interface RendlyLogoProps {
  className?: string;
  /** Show the "rendly" wordtype under the mark. */
  withWordmark?: boolean;
}

/**
 * Stacked brand logo (mark over wordtype), sized by its container.
 * Thin wrapper over components/brand/Brand.tsx so legacy call sites get the 2026 mark.
 */
export function RendlyLogo({ className = 'w-48 h-48', withWordmark = true }: RendlyLogoProps) {
  return (
    <span
      className={`inline-flex flex-col items-center justify-center gap-[7%] text-[var(--rd-text,#f7f8f8)] ${className}`}
      role="img"
      aria-label="Rendly"
    >
      <RendlyMark className={withWordmark ? 'h-[62%] w-auto' : 'h-full w-auto'} />
      {withWordmark ? <RendlyWordmark className="h-[13%] w-auto" /> : null}
    </span>
  );
}

export { RendlyMark, RendlyWordmark, RendlyLockup } from '@/components/brand/Brand';
export default RendlyLogo;
