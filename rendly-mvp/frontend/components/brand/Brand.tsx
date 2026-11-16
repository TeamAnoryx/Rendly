import React from 'react';
import { withBasePath } from '@/lib/basePath';

/**
 * Rendly brand primitives.
 * - RendlyMark: the five-node mark, vector, inherits currentColor (traced from the 2026 lockup).
 * - RendlyWordmark: the "rendly" wordtype, raster cut from the intro animation's final frame.
 * - RendlyLockup: mark + wordmark, for nav bars and auth headers.
 */

export function RendlyMark({ className, title }: { className?: string; title?: string }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 162 178"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={`rm-${id}`}>
          <g fill="none" stroke="#fff">
            <g strokeWidth="14">
              <circle cx="31" cy="31" r="22" />
              <circle cx="131" cy="31" r="22" />
              <circle cx="31" cy="147" r="22" />
              <circle cx="131" cy="147" r="22" />
            </g>
            <circle cx="84" cy="89" r="18.5" strokeWidth="15" />
            <path d="M50 31h62M31 50v78" strokeWidth="10" />
            <path d="M109 50L95 67M100 105l15 16" strokeWidth="9" />
          </g>
          <path d="M23 23L2 2M139 23L160 2M23 155L2 176M139 155L160 176" stroke="#000" strokeWidth="6.5" />
          <rect x="54" y="80" width="20" height="4.5" fill="#000" />
          <rect x="54" y="93.5" width="20" height="4.5" fill="#000" />
        </mask>
      </defs>
      <rect width="162" height="178" fill="currentColor" mask={`url(#rm-${id})`} />
    </svg>
  );
}

export function RendlyWordmark({
  className,
  tone = 'white',
}: {
  className?: string;
  tone?: 'white' | 'black';
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={withBasePath(`/brand/rendly-wordtype-${tone}.png`)}
      alt="rendly"
      className={className}
      draggable={false}
      decoding="async"
    />
  );
}

/**
 * Full Rendly lockup (mark + wordtype) at the brand's own proportions, cut from the
 * final frame of the logo film. Size it by height; width follows (about 4.45 : 1).
 */
export function RendlyLockup({
  className = 'h-7 w-auto',
  tone = 'white',
}: {
  className?: string;
  tone?: 'white' | 'black';
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={withBasePath(`/brand/rendly-wordmark-${tone}.png`)}
      alt="Rendly"
      className={`block select-none ${className}`}
      draggable={false}
      decoding="async"
    />
  );
}

/** "A product of ANORYX" signature for footers. `size="lg"` for standalone pages. */
export function AnoryxSignature({ className = '', size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <span className={`inline-flex flex-col items-center gap-3 ${className}`}>
      <span
        className={`font-medium uppercase text-[#8a8f98] ${lg ? 'text-[12.5px] tracking-[0.32em] text-[#a1a6ae]' : 'text-[11px] tracking-[0.28em]'}`}
      >
        A product of
      </span>
      <span className={`inline-flex items-center ${lg ? 'gap-4' : 'gap-3'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath('/images/anoryx-symbol-white.png')}
          alt=""
          className={lg ? 'h-9 w-9' : 'h-6 w-6'}
          draggable={false}
        />
        <span className={`w-px bg-white/20 ${lg ? 'h-6' : 'h-5'}`} aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath('/images/anoryx-wordmark-white.png')}
          alt="Anoryx"
          className={lg ? 'h-5 w-auto' : 'h-[15px] w-auto'}
          draggable={false}
        />
      </span>
    </span>
  );
}
