'use client';

import React, { useEffect, useRef, useState } from 'react';

type RevealTag = 'div' | 'li' | 'section' | 'article' | 'header' | 'p' | 'h2' | 'span';

interface RevealProps {
  as?: RevealTag;
  /** Stagger delay in ms. */
  delay?: number;
  className?: string;
  id?: string;
  children: React.ReactNode;
}

/**
 * Fades and lifts its children into view once, when they first cross the viewport.
 * Transforms are dropped under prefers-reduced-motion (see landing.css).
 */
export default function Reveal({ as = 'div', delay = 0, className = '', id, children }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const Tag = as as React.ElementType;
  return (
    <Tag
      ref={ref}
      id={id}
      className={`ld-reveal${shown ? ' is-in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
