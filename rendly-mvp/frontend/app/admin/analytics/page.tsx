import { redirect } from 'next/navigation';

/** Analytics now lives on the Overview page. */
export default function AdminAnalyticsPage() {
  redirect('/admin/dashboard');
}
