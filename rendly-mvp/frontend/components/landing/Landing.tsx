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

interface LandingProps {
  /** False holds the hero entrance (the welcome film is still on top); true plays it. */
  heroPlay?: boolean;
}

/** Rendly marketing landing page (Home). Mounted by HomeEntry, under the welcome film when it shows. */
export default function Landing({ heroPlay = true }: LandingProps) {
  useHashScroll();
  return (
    <div className="ld-root">
      <a href="#ld-main" className="ld-skip">
        Skip to content
      </a>
      <Nav />
      <main id="ld-main">
        <Hero play={heroPlay} />
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
