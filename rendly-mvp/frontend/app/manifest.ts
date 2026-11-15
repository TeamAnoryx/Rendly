import type { MetadataRoute } from 'next';
import { siteConfig } from '@/lib/site';

/** Web app manifest: lets phones install Rendly to the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#07070d',
    theme_color: '#07070d',
    icons: [
      { src: '/icon.png', sizes: 'any', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
