'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import RendlyLogo from './RendlyLogo';

interface AnimatedLogoProps {
  onAnimationComplete?: () => void;
}

/** Brand logo reveal: fade and settle, then a slow breathing opacity. */
export function AnimatedLogo({ onAnimationComplete }: AnimatedLogoProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="flex items-center justify-center"
      initial={reduce ? false : { opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={onAnimationComplete}
    >
      <motion.div
        animate={reduce ? undefined : { opacity: [1, 0.86, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
      >
        <RendlyLogo className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 lg:w-56 lg:h-56" />
      </motion.div>
    </motion.div>
  );
}

export default AnimatedLogo;
