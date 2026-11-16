import { RouteLoader } from '@/components/common/RouteLoader';

/** Loader inside the app shell while a dashboard page loads, so the rail stays in place. */
export default function DashboardLoading() {
  return <RouteLoader inline />;
}
