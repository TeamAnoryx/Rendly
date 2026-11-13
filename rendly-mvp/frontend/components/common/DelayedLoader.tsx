'use client';

import React, { useEffect, useState } from 'react';

const DELAY_MS = 300;
const SPACE_INDIGO = '#f7f8f8';
const GLAUCOUS = '#62666d';
const CYAN = '#f7f8f8';

export type DelayedLoaderProps = {
  delay?: number;
  size?: 'sm' | 'md' | 'lg';
  message?: string | null;
  showOverlay?: boolean;
  isActive?: boolean;
};

const sizeMap = {
  sm: { container: 48, ringOuter: 44, ringInner: 28, dot: 8 },
  md: { container: 80, ringOuter: 72, ringInner: 48, dot: 14 },
  lg: { container: 120, ringOuter: 108, ringInner: 72, dot: 20 },
};

/**
 * CSS-only loader (no framer-motion) for fast initial compile.
 */
export default function DelayedLoader({
  delay = DELAY_MS,
  size = 'md',
  message = null,
  showOverlay = true,
  isActive = true,
}: DelayedLoaderProps) {
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setShowSpinner(false);
      return;
    }
    const t = setTimeout(() => setShowSpinner(true), delay);
    return () => clearTimeout(t);
  }, [isActive, delay]);

  if (!showSpinner || !isActive) return null;

  const dims = sizeMap[size];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center loader-overlay"
      role="status"
      aria-label="Loading"
    >
      {showOverlay && (
        <div className="absolute inset-0 bg-black/50 loader-overlay" aria-hidden />
      )}
      <div
        className="relative flex flex-col items-center gap-4"
        style={{ width: dims.container, height: dims.container }}
      >
        <div
          className="loader-ring-cw absolute rounded-full border-2 border-transparent"
          style={{
            width: dims.ringOuter,
            height: dims.ringOuter,
            borderTopColor: SPACE_INDIGO,
            borderRightColor: SPACE_INDIGO,
          }}
        />
        <div
          className="loader-ring-ccw absolute rounded-full border-2 border-transparent"
          style={{
            width: dims.ringInner,
            height: dims.ringInner,
            borderBottomColor: GLAUCOUS,
            borderLeftColor: GLAUCOUS,
          }}
        />
        <div
          className="loader-dot absolute rounded-full"
          style={{
            width: dims.dot,
            height: dims.dot,
            top: '50%',
            left: '50%',
            marginTop: -dims.dot / 2,
            marginLeft: -dims.dot / 2,
            background: `linear-gradient(135deg, ${CYAN}, #8a8f98)`,
          }}
        />
      </div>
      {message && (
        <p className="mt-2 text-sm text-primary font-medium">{message}</p>
      )}
    </div>
  );
}
