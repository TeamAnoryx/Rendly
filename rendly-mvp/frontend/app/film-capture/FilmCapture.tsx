'use client';

import ProductFilm from '@/components/landing/ProductFilm';
import './film-capture.css';

/** The bare film filling the window; driven by window.__rendlyFilm (seek / settle) for export. */
export default function FilmCapture() {
  return (
    <div className="fc-root">
      <ProductFilm variant="player" />
    </div>
  );
}
