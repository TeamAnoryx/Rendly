import { notFound } from 'next/navigation';
import FilmCapture from './FilmCapture';

export const metadata = { title: 'Film capture', robots: { index: false, follow: false } };

/**
 * Development-only stage for exporting the product film frame by frame:
 * the bare player, full screen, without controls. Not served in production.
 */
export default function FilmCapturePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FilmCapture />;
}
