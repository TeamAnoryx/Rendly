import React from 'react';

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
      src={`/brand/rendly-wordtype-${tone}.png`}
      alt="rendly"
      className={className}
      draggable={false}
      decoding="async"
    />
  );
}

export function RendlyLockup({
  className = '',
  markClassName = 'h-[18px] w-auto',
  wordClassName = 'h-[16px] w-auto',
  tone = 'white',
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  tone?: 'white' | 'black';
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${tone === 'white' ? 'text-white' : 'text-black'} ${className}`}>
      <RendlyMark className={markClassName} />
      <RendlyWordmark className={wordClassName} tone={tone} />
    </span>
  );
}

/** "A product of ANORYX" signature, used in footers. */
export function AnoryxSignature({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] uppercase text-[#62666d] ${className}`}>
      A product of
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/anoryx-symbol-white.png" alt="" className="h-4 w-4 opacity-70" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/anoryx-wordmark-white.png" alt="Anoryx" className="h-[10px] w-auto opacity-70" draggable={false} />
    </span>
  );
}
