import type { Metadata } from 'next';
import ContactPage from '@/components/contact/ContactPage';

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact Rendly',
  description: 'Questions, feedback or a problem with Rendly? Send it to the Rendly team and a real person replies.',
};

export default function Page() {
  return <ContactPage />;
}
