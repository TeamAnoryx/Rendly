import type { Metadata } from 'next';
import HomeEntry from '@/components/landing/HomeEntry';

export const metadata: Metadata = {
  title: 'Home | Rendly',
};

/** Home. The intro film lives on /intro; see HomeEntry for the hand-over. */
export default function Page() {
  return <HomeEntry />;
}
