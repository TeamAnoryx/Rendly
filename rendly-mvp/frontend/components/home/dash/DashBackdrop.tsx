'use client';

import React from 'react';
import './dash-backdrop.css';

/**
 * Purely decorative ambient layer placed behind the dashboard grid.
 * Parent must be `position: relative; overflow: hidden`.
 */
export default function DashBackdrop() {
  return (
    <div className="db-root" aria-hidden="true">
      <div className="db-grid" />
      <div className="db-blob db-blob--a" />
      <div className="db-blob db-blob--b" />
      <div className="db-blob db-blob--c" />
      <div className="db-beam" />
      <div className="db-noise" />
      <div className="db-vignette" />
    </div>
  );
}

export { DashBackdrop };
