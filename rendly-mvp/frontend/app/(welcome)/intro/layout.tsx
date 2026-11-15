import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome',
  robots: { index: false, follow: true },
};

export default function IntroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
