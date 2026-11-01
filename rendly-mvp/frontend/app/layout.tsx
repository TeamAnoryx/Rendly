import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import '@/styles/rendly-theme.css';
import LoadingProviderClient from '@/components/common/LoadingProviderClient';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07070d',
};

export const metadata: Metadata = {
  title: 'Rendly - Connect, Match, Engage',
  description: 'Real-time intent-based social matching platform',
  authors: [{ name: 'Rendly Team' }],
  openGraph: {
    title: 'Rendly',
    description: 'Connect, Match, Engage',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} style={{ colorScheme: 'dark' }}>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="bg-background text-foreground antialiased">
        <LoadingProviderClient>{children}</LoadingProviderClient>
      </body>
    </html>
  );
}
