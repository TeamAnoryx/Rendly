'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { useFitCount } from './useFitCount';

/** Row geometry shared with `.ss-paged` in setup-controls.css. */
export const ROW_PX = 42;
export const ROW_GAP_PX = 6;

export type PagedListProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  /** Names what is being paged, for the pager's labels ("trending intents"). */
  label: string;
  className?: string;
};

/**
 * Shows as many fixed-height rows as fit the space it is given, with a pager for the rest.
 * Nothing inside ever scrolls: overflow becomes pages.
 */
export default function PagedList<T>({ items, getKey, renderItem, label, className = '' }: PagedListProps<T>) {
  const reduce = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const perPage = useFitCount(viewportRef, ROW_PX, ROW_GAP_PX);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);

  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * perPage, current * perPage + perPage);
  const go = (delta: number) => {
    setDir(delta);
    setPage((p) => Math.min(pages - 1, Math.max(0, p + delta)));
  };

  return (
    <div className={`ss-paged ${className}`}>
      <div className="ss-paged__viewport" ref={viewportRef}>
        <motion.div
          key={current}
          className="ss-list"
          initial={reduce ? false : { opacity: 0, x: 14 * dir }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {slice.map((item) => (
            <React.Fragment key={getKey(item)}>{renderItem(item)}</React.Fragment>
          ))}
        </motion.div>
      </div>
      {pages > 1 && (
        <div className="ss-pager" role="group" aria-label={`${label} pages`}>
          <button
            type="button"
            className="ss-pager__btn"
            aria-label={`Previous ${label}`}
            disabled={current === 0}
            onClick={() => go(-1)}
          >
            <span className="ss-pager__flip">
              <Icon name="chevron-right" size={14} />
            </span>
          </button>
          <span className="ss-pager__dots" aria-live="polite">
            <span className="ss-sr">
              Page {current + 1} of {pages}
            </span>
            {Array.from({ length: pages }, (_, i) => (
              <span key={i} className={`ss-pager__dot${i === current ? ' ss-pager__dot--on' : ''}`} aria-hidden="true" />
            ))}
          </span>
          <button
            type="button"
            className="ss-pager__btn"
            aria-label={`Next ${label}`}
            disabled={current >= pages - 1}
            onClick={() => go(1)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
