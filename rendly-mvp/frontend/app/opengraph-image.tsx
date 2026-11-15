import { ImageResponse } from 'next/og';
import { siteConfig } from '@/lib/site';

export const runtime = 'edge';
export const alt = `${siteConfig.name}: ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Social share card used by Open Graph and Twitter for every page without its own image. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: 'radial-gradient(circle at 80% 20%, #1d2a6b 0%, #07070d 55%)',
          color: '#fafafa',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700 }}>Rendly</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>Know your why.</div>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, color: '#8ea2ff' }}>Find your who.</div>
        </div>
        <div style={{ fontSize: 28, color: '#a1a1aa' }}>Intent-based networking · Spark · Whispers · Huddles · by Anoryx</div>
      </div>
    ),
    size,
  );
}
