import { absoluteUrl, faqs, siteConfig } from '@/lib/site';

/**
 * Site-wide structured data (schema.org JSON-LD) so search and answer engines know what
 * Rendly is, who publishes it, and the common questions about it.
 */
export function siteJsonLd(): Record<string, unknown> {
  const orgId = `${siteConfig.anoryxUrl}/#organization`;
  const siteId = `${siteConfig.url}/#website`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: siteConfig.publisher,
        url: siteConfig.anoryxUrl,
        logo: absoluteUrl('/images/anoryx-symbol-white.png'),
      },
      {
        '@type': 'WebSite',
        '@id': siteId,
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        inLanguage: 'en',
        publisher: { '@id': orgId },
      },
      {
        '@type': 'SoftwareApplication',
        name: siteConfig.name,
        url: siteConfig.url,
        applicationCategory: 'SocialNetworkingApplication',
        operatingSystem: 'Web',
        description: siteConfig.description,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': orgId },
        isPartOf: { '@id': siteId },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };
}

export default function JsonLd() {
  // Escape "<" so the JSON can never close the script tag early.
  const json = JSON.stringify(siteJsonLd()).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
