'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import type { HuddleListItem } from '@/hooks/useHuddles';

type HuddleListProps = {
  trendy: HuddleListItem[];
  live: HuddleListItem[];
  loading: boolean;
  error: string | null;
};

function Carousel({
  title,
  items,
  variant,
  emptyMessage,
}: {
  title: string;
  items: HuddleListItem[];
  variant: 'trendy' | 'live';
  emptyMessage: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: number) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 280, behavior: 'smooth' });
  };

  return (
    <section className={`dash-huddles-section dash-huddles-section--${variant}`}>
      <h2 className="dash-huddles-section-title">{title}</h2>
      <div className="dash-huddles-carousel-wrap">
        <button
          type="button"
          className="dash-huddles-carousel-nav dash-huddles-carousel-nav--left"
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <span aria-hidden>&lt;</span>
        </button>
        <div className="dash-huddles-carousel" ref={scrollRef}>
          {items.length === 0 ? (
            <p className="dash-huddles-empty">{emptyMessage}</p>
          ) : (
            items.map((h) => (
              <Link
                key={h.id}
                href={`/dashboard/huddles/${h.id}`}
                className="dash-huddles-card"
                data-variant={variant}
              >
                <div className="dash-huddles-card-band" data-variant={variant} />
                <div className="dash-huddles-card-body">
                  <h3 className="dash-huddles-card-title">{h.title}</h3>
                  <p className="dash-huddles-card-meta">
                    {h.participants_count}
                    {h.max_participants ? ` / ${h.max_participants}` : ''} participants
                  </p>
                  {h.type && (
                    <span className="dash-huddles-card-type">{h.type}</span>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
        <button
          type="button"
          className="dash-huddles-carousel-nav dash-huddles-carousel-nav--right"
          onClick={() => scroll(1)}
          aria-label="Scroll right"
        >
          <span aria-hidden>&gt;</span>
        </button>
      </div>
    </section>
  );
}

export default function HuddleList({ trendy, live, loading, error }: HuddleListProps) {
  if (loading) {
    return (
      <div className="dash-huddles-root">
        <div className="dash-huddles-loading">Loading huddles…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="dash-huddles-root">
        <div className="dash-huddles-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  return (
    <div className="dash-huddles-list-root">
      <Carousel
        title="#Trendy Huddles"
        items={trendy}
        variant="trendy"
        emptyMessage="No trendy huddles right now."
      />
      <Carousel
        title="*LIVE Huddles"
        items={live}
        variant="live"
        emptyMessage="No live huddles right now."
      />
    </div>
  );
}
