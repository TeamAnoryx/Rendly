'use client';

import React from 'react';
import Nav from './Nav';
import { Footer } from './Closing';
import './landing.css';

interface SiteShellProps {
  children: React.ReactNode;
}

/** Marketing chrome (nav + footer) shared by /about, /terms and /privacy. */
export default function SiteShell({ children }: SiteShellProps) {
  return (
    <div className="ld-root">
      <a href="#ld-main" className="ld-skip">
        Skip to content
      </a>
      <Nav />
      <main id="ld-main" className="ld-page">
        {children}
      </main>
      <Footer />
    </div>
  );
}
