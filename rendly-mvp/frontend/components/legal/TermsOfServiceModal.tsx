'use client';

import React from 'react';
import ModalOverlay from './ModalOverlay';
import { LegalContentRenderer } from './LegalContentRenderer';
import { TERMS_SECTIONS } from '@/content/legalContent';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onAgree?: () => void;
};

export default function TermsOfServiceModal({ isOpen, onClose, onAgree }: Props) {
  const footer = (
    <>
      {onAgree && (
        <button
          type="button"
          onClick={() => {
            onAgree();
            onClose();
          }}
          className="rd-btn rd-btn--primary"
        >
          I agree
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="rd-btn"
      >
        Close
      </button>
    </>
  );

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="Terms of Service"
      footer={footer}
      closeOnBackdropClick
    >
      <LegalContentRenderer sections={TERMS_SECTIONS} />
    </ModalOverlay>
  );
}
