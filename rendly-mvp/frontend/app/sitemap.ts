import type { MetadataRoute } from 'next';
import { absoluteUrl, publicRoutes } from '@/lib/site';

/** /sitemap.xml: public pages only. Everything behind sign-in stays out of the index. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return publicRoutes.map((r) => ({
    url: absoluteUrl(r.path),
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
