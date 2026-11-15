import type { Metadata } from 'next';
import LegalPage from '@/components/landing/LegalPage';
import { TERMS_EFFECTIVE, TERMS_LAST_UPDATED, TERMS_SECTIONS } from '@/content/legalContent';

export const metadata: Metadata = {
  alternates: { canonical: '/terms' },
  title: 'Terms of Service | Rendly',
  description: 'The terms that govern your use of Rendly, the intent-based networking app.',
};

export default function TermsPage() {
  return (
    <LegalPage
      kind="terms"
      title="Terms of Service"
      effective={TERMS_EFFECTIVE}
      updated={TERMS_LAST_UPDATED}
      sections={TERMS_SECTIONS}
    />
  );
}
