'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';

/** How long the prompt stays before sliding away on its own. */
export const PERMISSION_PROMPT_MS = 3000;
/** Horizontal drag (px) past which a swipe dismisses the prompt on touch screens. */
const SWIPE_DISMISS_PX = 80;

/**
 * Slide-in prompt for permission grants ("you can share your screen now"). It hides after 3s, can be
 * closed with the × button, or swiped away on touch screens.
 */
export default function PermissionPrompt({ message, onClose }: { message: string | null; onClose: () => void }) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onClose, PERMISSION_PROMPT_MS);
    return () => window.clearTimeout(id);
  }, [message, onClose]);

  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          key={message}
          className="hr-grant"
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: 120 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.6}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > SWIPE_DISMISS_PX) onClose();
          }}
        >
          <span className="hr-grant-icon" aria-hidden>
            <Icon name="screen" size={16} />
          </span>
          <p className="hr-grant-text">{message}</p>
          <button type="button" className="hr-grant-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
          {reduce ? null : (
            <motion.span
              className="hr-grant-timer"
              aria-hidden
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: PERMISSION_PROMPT_MS / 1000, ease: 'linear' }}
            />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
