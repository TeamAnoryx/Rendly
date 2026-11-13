'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useModal } from '@/hooks/useModal';
import TermsOfServiceModal from '@/components/legal/TermsOfServiceModal';
import PrivacyPolicyModal from '@/components/legal/PrivacyPolicyModal';

interface TermsCheckboxProps {
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Terms + privacy agreement. Ticking it opens the Terms modal; "I agree" there sets the value.
 * Must be rendered inside AuthProvider.
 */
export default function TermsCheckbox({ id = 'auth-terms', invalid, describedBy }: TermsCheckboxProps) {
  const { termsChecked, setTermsChecked } = useAuth();
  const termsModal = useModal(false);
  const privacyModal = useModal(false);

  return (
    <>
      <div className="au-terms">
        <input
          id={id}
          type="checkbox"
          className="au-checkbox"
          checked={termsChecked}
          onChange={(e) => {
            if (e.target.checked) termsModal.open();
            else setTermsChecked(false);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <span>
          <label htmlFor={id} style={{ cursor: 'pointer' }}>
            I agree to Rendly&apos;s
          </label>{' '}
          <button type="button" className="au-terms__link" onClick={termsModal.open}>
            Terms of Service
          </button>{' '}
          and{' '}
          <button type="button" className="au-terms__link" onClick={privacyModal.open}>
            Privacy Policy
          </button>
          .
        </span>
      </div>
      <TermsOfServiceModal isOpen={termsModal.isOpen} onClose={termsModal.close} onAgree={() => setTermsChecked(true)} />
      <PrivacyPolicyModal isOpen={privacyModal.isOpen} onClose={privacyModal.close} />
    </>
  );
}
