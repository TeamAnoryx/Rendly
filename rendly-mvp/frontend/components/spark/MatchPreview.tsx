'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { Icon } from '@/components/shell/Icon';
import type { SetupSnapshot } from './SparkSetup';
import './match-preview.css';

/** Faces for the preview stack (same photos as the orbit behind it). */
const FACES = ['/images/pov22.jpg', '/images/pov24.jpg', '/images/pov29.jpg'];
const MAX_ECHO = 3;

export type MatchPreviewProps = {
  snapshot: SetupSnapshot | null;
};

/** Floating card over the orbit that mirrors the current setup as a match preview. */
export default function MatchPreview({ snapshot }: MatchPreviewProps) {
  const reduce = useReducedMotion();
  const labels = snapshot?.labels ?? [];
  const echo = labels.slice(0, MAX_ECHO);
  const extra = labels.length - echo.length;
  const ready = labels.length > 0;

  return (
    <motion.div
      className={`mp-card${ready ? ' mp-card--ready' : ''}`}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.9, delay: reduce ? 0 : 0.85, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mp-top">
        <div className="mp-faces" aria-hidden="true">
          {FACES.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="mp-face" />
          ))}
          <span className="mp-face mp-face--you">
            <Icon name="spark" size={14} />
          </span>
        </div>
        <span className={`mp-live${reduce ? '' : ' mp-live--pulse'}`}>
          <span className="mp-live__dot" /> Live preview
        </span>
      </div>

      <p className="mp-kicker">Your Spark</p>
      <p className="mp-title">
        {ready ? (
          <>
            People who share <span className="rd-spectrum-text">your why</span>
          </>
        ) : (
          'Pick a why. We find who shares it.'
        )}
      </p>

      <div className="mp-echo">
        <AnimatePresence initial={false} mode="popLayout">
          {echo.map((l) => (
            <motion.span
              key={l}
              className="mp-tag"
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, scale: 0.85, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 480, damping: 32 }}
            >
              {l}
            </motion.span>
          ))}
          {extra > 0 && (
            <motion.span key="extra" className="mp-tag mp-tag--more" layout={!reduce}>
              +{extra}
            </motion.span>
          )}
        </AnimatePresence>
        {!ready && <span className="mp-tag mp-tag--ghost">#your-intent</span>}
      </div>

      <div className="mp-meta">
        <span className="mp-meta__item">
          <Icon name={snapshot?.mode === 'video' ? 'video' : 'chat'} size={13} />
          {snapshot?.mode === 'video' ? 'Video' : 'Text first'}
        </span>
        <span className="mp-meta__item">
          <Icon name={snapshot?.anonymous ? 'lock' : 'user'} size={13} />
          {snapshot?.anonymous ? 'Anonymous' : 'Public'}
        </span>
        <span className="mp-meta__item mp-meta__cost">
          <TokenCoin size={13} />
          {snapshot?.cost ?? 0}
        </span>
      </div>
    </motion.div>
  );
}
