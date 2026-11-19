import type { Metadata } from 'next';
import HomeEntry from '@/components/landing/HomeEntry';
import { siteConfig } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: 'Rendly | Intent-based networking: know your why, find your who' },
  // The exact URL, no trailing slash: /rendly.app/ redirects to /rendly.app.
  alternates: { canonical: siteConfig.url },
};

/** Home. The intro film lives on /intro; see HomeEntry for the hand-over. */
export default function Page() {
  return <HomeEntry />;
}
