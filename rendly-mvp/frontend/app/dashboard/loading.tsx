import { DashboardSkeleton } from '@/components/common/SkeletonLoader';

/**
 * Shown inside the app shell while a dashboard route segment loads: same layout as Home,
 * so the swap to real content does not jump.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
