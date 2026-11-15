import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site';

const PRIVATE_PATHS = ['/dashboard/', '/admin/', '/api/', '/auth/callback', '/profile-setup', '/profile/', '/login/reset-password'];

/** /robots.txt: public pages are open to search and AI answer engines; signed-in areas are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'], allow: '/', disallow: PRIVATE_PATHS },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
