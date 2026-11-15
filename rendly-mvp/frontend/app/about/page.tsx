import type { Metadata } from 'next';
import About from '@/components/about/About';

export const metadata: Metadata = {
  alternates: { canonical: '/about' },
  title: 'About Rendly | Know your why. Find your who.',
  description:
    'Rendly is intent-based networking: tell it what you are looking for and meet someone who wants the same thing, one-to-one on Spark, in Whispers and in Huddles.',
};

export default function AboutPage() {
  return <About />;
}
