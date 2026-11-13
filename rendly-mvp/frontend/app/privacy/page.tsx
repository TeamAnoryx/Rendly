import type { Metadata } from 'next';
import LegalPage from '@/components/landing/LegalPage';
import { PRIVACY_EFFECTIVE, PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from '@/content/legalContent';

export const metadata: Metadata = {
  title: 'Privacy Policy | Rendly',
  description: 'How Rendly collects, uses and protects your information.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      kind="privacy"
      title="Privacy Policy"
      effective={PRIVACY_EFFECTIVE}
      updated={PRIVACY_LAST_UPDATED}
      sections={PRIVACY_SECTIONS}
    />
  );
}
