'use client';

import { useEffect, type RefObject } from 'react';

/** Closes a popover on Escape or on a pointer press outside `ref`. */
export function useDismiss(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [ref, open, onClose]);
}
