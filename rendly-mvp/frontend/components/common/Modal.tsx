'use client';

import React, { useEffect } from 'react';

type ModalProps = {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

/** Generic dialog on the .rd-modal surface. Escape and backdrop click close it. */
export default function Modal({ open = false, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="rd-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="rd-modal" role="dialog" aria-modal="true">
        {title ? <h2 className="rd-h2 mb-3">{title}</h2> : null}
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
