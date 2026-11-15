/** @type {import('next').NextConfig} */
const nextConfig = {
  // Each dev server needs its own build folder when several run from this project.
  // Set NEXT_DIST_DIR (e.g. .next-3011) per server; defaults to .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  swcMinify: true,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Big static media (film clips, fonts, images, audio) never changes under the same
  // filename, so let browsers and the CDN keep it for a year instead of revalidating.
  async headers() {
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }];
    return [
      { source: '/film/:path*', headers: immutable },
      { source: '/fonts/:path*', headers: immutable },
      { source: '/images/:path*', headers: immutable },
      { source: '/audio/:path*', headers: immutable },
      { source: '/sounds/:path*', headers: immutable },
      { source: '/video/:path*', headers: immutable },
    ];
  },
  experimental: {
    instrumentationHook: true,
    optimizePackageImports: [
      'framer-motion',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: 'api.example.com' },
      { protocol: 'https', hostname: '**.example.com' },
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
  // compiler.removeConsole not supported with Turbopack; omit to use --turbo
  webpack: (config, { dev }) => {
    if (dev) {
      // Use memory cache to avoid ENOENT / missing chunk (e.g. 276.js) on Windows
      config.cache = { type: 'memory' };
    }
    return config;
  },
};

module.exports = nextConfig;
