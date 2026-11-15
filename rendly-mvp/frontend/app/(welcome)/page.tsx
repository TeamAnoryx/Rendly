import type { Metadata } from 'next';
import HomeEntry from '@/components/landing/HomeEntry';

export const metadata: Metadata = {
  title: { absolute: 'Rendly | Intent-based networking: know your why, find your who' },
  alternates: { canonical: './' },
};

/** Home. The intro film lives on /intro; see HomeEntry for the hand-over. */
export default function Page() {
  return <HomeEntry />;
}
