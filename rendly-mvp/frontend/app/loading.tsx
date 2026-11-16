import { RouteLoader } from '@/components/common/RouteLoader';

/** Branded full-screen loader while a route loads; styled inline so it never flashes unstyled. */
export default function Loading() {
  return <RouteLoader />;
}
