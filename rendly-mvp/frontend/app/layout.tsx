import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import '@/styles/rendly-theme.css';
// Dashboard + app-shell styles live in the root layout so they are already in the <head> when a
// client-side navigation (e.g. the redirect after sign-in) commits the dashboard: otherwise the
// page paints for a moment before its route stylesheet arrives. Both files are class-scoped.
import '@/components/shell/shell.css';
import './dashboard/dashboard.css';
import LoadingProviderClient from '@/components/common/LoadingProviderClient';
import RouteTransition from '@/components/common/RouteTransition';
import JsonLd from '@/components/seo/JsonLd';
import { siteConfig } from '@/lib/site';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  // 'block' holds text for a moment instead of flashing the fallback font, then swapping.
  display: 'block',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07070d',
};

export const metadata: Metadata = {
  metadataBase: new URL(`${siteConfig.url}/`),
  title: { default: siteConfig.title, template: '%s | Rendly' },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.publisher, url: siteConfig.anoryxUrl }],
  creator: siteConfig.publisher,
  publisher: siteConfig.publisher,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    url: './',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
  category: 'social networking',
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
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM summary" />
        <JsonLd />
      </head>
      <body className="bg-background text-foreground antialiased">
        <LoadingProviderClient>{children}</LoadingProviderClient>
        <RouteTransition />
      </body>
    </html>
  );
}
