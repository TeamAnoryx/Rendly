import React from 'react';

/**
 * Full-screen branded loader shown while a page loads. Styled inline (no stylesheet), so it can
 * never appear unstyled, unlike skeletons built from page CSS that may still be on its way.
 */
const SPIN_CSS = '@keyframes rd-route-spin{to{transform:rotate(360deg)}}';

export function RouteLoader({ inline = false }: { inline?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: inline ? 'relative' : 'fixed',
        inset: inline ? undefined : 0,
        minHeight: inline ? '60vh' : undefined,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: inline ? 'transparent' : '#07070d',
      }}
    >
      <style>{SPIN_CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/rendly-mark.svg" alt="" width={44} height={44} style={{ opacity: 0.92 }} />
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.14)',
          borderTopColor: '#ffffff',
          animation: 'rd-route-spin 0.8s linear infinite',
        }}
      />
    </div>
  );
}

export default RouteLoader;
