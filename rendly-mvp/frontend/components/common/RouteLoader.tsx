import React from 'react';
import { withBasePath } from '@/lib/basePath';

/**
 * Full-screen branded loader shown while a page loads. Styled inline (no stylesheet), so it can
 * never appear unstyled, unlike skeletons built from page CSS that may still be on its way.
 * The white mark breathes inside a spinning ring; the label's dots fade in turn.
 */
const LOADER_CSS = `
@keyframes rd-route-spin{to{transform:rotate(360deg)}}
@keyframes rd-route-breathe{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.06);opacity:1}}
@keyframes rd-route-dot{0%,80%,100%{opacity:.2}40%{opacity:1}}
@keyframes rd-route-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.rd-route-dot{animation:rd-route-dot 1.2s ease-in-out infinite}
.rd-route-dot:nth-child(2){animation-delay:.2s}
.rd-route-dot:nth-child(3){animation-delay:.4s}
@media (prefers-reduced-motion:reduce){.rd-route-anim,.rd-route-dot{animation:none!important}}
`;

const RING_SIZE = 112;
const MARK_SIZE = 64;

export function RouteLoader({ inline = false }: { inline?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading, please wait"
      style={{
        position: inline ? 'relative' : 'fixed',
        inset: inline ? undefined : 0,
        minHeight: inline ? '60vh' : undefined,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
        background: inline ? 'transparent' : '#07070d',
      }}
    >
      <style>{LOADER_CSS}</style>
      <div
        className="rd-route-anim"
        style={{
          position: 'relative',
          width: RING_SIZE,
          height: RING_SIZE,
          display: 'grid',
          placeItems: 'center',
          animation: 'rd-route-in 0.35s ease-out both',
        }}
      >
        <span
          aria-hidden
          className="rd-route-anim"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.10)',
            borderTopColor: '#ffffff',
            borderRightColor: 'rgba(255,255,255,0.45)',
            animation: 'rd-route-spin 1s linear infinite',
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath('/brand/rendly-icon-white.png')}
          alt=""
          width={MARK_SIZE}
          height={MARK_SIZE}
          className="rd-route-anim"
          style={{ objectFit: 'contain', animation: 'rd-route-breathe 1.8s ease-in-out infinite' }}
        />
      </div>
      <p
        className="rd-route-anim"
        style={{
          margin: 0,
          color: 'rgba(255,255,255,0.82)',
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: '0.02em',
          animation: 'rd-route-in 0.35s ease-out 0.08s both',
        }}
      >
        Loading, please wait
        <span aria-hidden>
          <span className="rd-route-dot">.</span>
          <span className="rd-route-dot">.</span>
          <span className="rd-route-dot">.</span>
        </span>
      </p>
    </div>
  );
}

export default RouteLoader;
