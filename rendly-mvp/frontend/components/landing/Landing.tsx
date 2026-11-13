'use client';

import React from 'react';
import Nav from './Nav';
import Hero from './Hero';
import Features from './Features';
import HowItWorks from './HowItWorks';
import ProductBands from './ProductBands';
import ProductFilm from './ProductFilm';
import { FinalCta, Footer } from './Closing';
import { useHashScroll } from './useHashScroll';
import './landing.css';

/** Rendly marketing landing page. Mounted by app/page.tsx beneath the intro splash. */
export default function Landing() {
  useHashScroll();
  return (
    <div className="ld-root">
      <a href="#ld-main" className="ld-skip">
        Skip to content
      </a>
      <Nav />
      <main id="ld-main">
        <Hero />
        <Features />
        <HowItWorks />
        <ProductBands />
        <ProductFilm />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
