'use client';

import React from 'react';
import ModalOverlay from './ModalOverlay';
import { LegalContentRenderer } from './LegalContentRenderer';
import { PRIVACY_SECTIONS } from '@/content/legalContent';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function PrivacyPolicyModal({ isOpen, onClose }: Props) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="Privacy Policy"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rd-btn"
        >
          Close
        </button>
      }
      closeOnBackdropClick
    >
      <LegalContentRenderer sections={PRIVACY_SECTIONS} />
    </ModalOverlay>
  );
}
