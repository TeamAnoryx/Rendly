'use client';

import React, { useEffect, useRef, useState } from 'react';

const OVERLAY_STYLES = {
  overlay: 'fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6',
  backdrop: 'absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ease-out',
  container:
    'relative z-10 w-full max-w-[720px] max-h-[86vh] flex flex-col rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0f1011] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-all duration-200 ease-out',
  header: 'flex items-center justify-between gap-4 shrink-0 px-5 py-4 sm:px-6 border-b border-[rgba(255,255,255,0.08)]',
  title: 'text-[15px] font-semibold tracking-[-0.01em] text-[#f7f8f8]',
  closeButton:
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#8a8f98] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)] hover:text-[#f7f8f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
  body: 'flex-1 min-h-0 overflow-y-auto px-5 py-5 sm:px-6',
  footer:
    'shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 px-5 py-4 sm:px-6 border-t border-[rgba(255,255,255,0.08)]',
};

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

type ModalOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** If true, clicking the backdrop closes the modal */
  closeOnBackdropClick?: boolean;
};

export default function ModalOverlay({
  isOpen,
  onClose,
  title,
  children,
  footer,
  closeOnBackdropClick = true,
}: ModalOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [show, setShow] = useState(isOpen);
  const titleId = React.useId();

  useEffect(() => {
    if (isOpen) setShow(true);
    else {
      const t = setTimeout(() => setShow(false), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (show) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [show]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [isOpen]);

  const exiting = !isOpen && show;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!closeOnBackdropClick || exiting) return;
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!show) return null;

  return (
    <div className={OVERLAY_STYLES.overlay} onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={`${OVERLAY_STYLES.backdrop} ${exiting ? 'opacity-0' : 'opacity-100'}`} aria-hidden />
      <div
        ref={containerRef}
        className={`${OVERLAY_STYLES.container} ${exiting ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={OVERLAY_STYLES.header}>
          <h2 id={titleId} className={OVERLAY_STYLES.title}>
            {title}
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className={OVERLAY_STYLES.closeButton} aria-label="Close">
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <div className={OVERLAY_STYLES.body}>{children}</div>
        {footer != null && <footer className={OVERLAY_STYLES.footer}>{footer}</footer>}
      </div>
    </div>
  );
}
