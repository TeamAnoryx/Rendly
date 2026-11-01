import { authFetch } from '@/lib/api';

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === 'string' && message ? message : fallback);
  }
  return data as T;
}

export async function listNotifications(): Promise<AppNotification[]> {
  const res = await authFetch('/api/notifications');
  const data = await parseOrThrow<unknown>(res, 'Could not load notifications');
  return Array.isArray(data) ? (data as AppNotification[]) : [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await authFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  await parseOrThrow<unknown>(res, 'Could not update the notification');
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await authFetch('/api/notifications/read-all', { method: 'PATCH' });
  await parseOrThrow<unknown>(res, 'Could not update notifications');
}

export async function clearAllNotifications(): Promise<void> {
  const res = await authFetch('/api/notifications', { method: 'DELETE' });
  await parseOrThrow<unknown>(res, 'Could not clear notifications');
}

/** Where a notification should take the user when clicked, or null to stay put. */
export function notificationHref(n: AppNotification): string | null {
  const p = n.payload ?? {};
  const huddleId = typeof p.huddle_id === 'string' ? p.huddle_id : null;
  const convId = typeof p.conversation_id === 'string' ? p.conversation_id : null;
  switch (n.type) {
    case 'message':
    case 'call':
      return convId ? `/dashboard/chat?conv=${encodeURIComponent(convId)}` : '/dashboard/chat';
    case 'huddle_created':
    case 'huddle_invite':
    case 'breakout':
    case 'points_awarded':
      return huddleId ? `/dashboard/huddles/${encodeURIComponent(huddleId)}` : '/dashboard/huddles';
    case 'huddle_cancelled':
      return '/dashboard/huddles';
    case 'connection_request':
    case 'connection_accepted':
    case 'profile_updated':
      return '/dashboard/profile';
    case 'group_invite':
      return '/dashboard/chat?tab=Group';
    default:
      return null;
  }
}

/** A short emoji-free icon key per type, used by the UI to pick an icon. */
export function notificationIcon(type: string): string {
  if (type === 'message') return 'chat';
  if (type === 'call') return 'phone';
  if (type.startsWith('huddle') || type === 'breakout') return 'huddle';
  if (type.startsWith('connection')) return 'people';
  if (type === 'points_awarded') return 'star';
  if (type === 'group_invite') return 'group';
  return 'bell';
}
