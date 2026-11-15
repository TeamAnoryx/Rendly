/** Huddles the user asked to be reminded about, kept in this browser until the huddle goes live. */

export type HuddleRef = {
  id: string;
  title: string;
  scheduled_at: string | null;
};

const STORAGE_KEY = 'rendly_huddle_reminders';
const MAX_REMINDERS = 20;

function isHuddleRef(value: unknown): value is HuddleRef {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    (v.scheduled_at === null || typeof v.scheduled_at === 'string')
  );
}

export function listReminders(): HuddleRef[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isHuddleRef) : [];
  } catch {
    return [];
  }
}

function save(list: HuddleRef[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_REMINDERS)));
  } catch {
    /* storage unavailable: the reminder simply does not persist */
  }
}

export function hasReminder(id: string): boolean {
  return listReminders().some((r) => r.id === id);
}

export function addReminder(ref: HuddleRef): void {
  if (typeof window === 'undefined') return;
  save([...listReminders().filter((r) => r.id !== ref.id), { id: ref.id, title: ref.title, scheduled_at: ref.scheduled_at }]);
}

export function removeReminder(id: string): void {
  if (typeof window === 'undefined') return;
  save(listReminders().filter((r) => r.id !== id));
}

/** The page a reminder (or its browser notification) opens. */
export function huddleJoinHref(id: string): string {
  return `/dashboard/huddles/${encodeURIComponent(id)}`;
}

/** Ask for browser notification permission. Resolves true when notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Show the "huddle is live" browser notification; clicking it opens the huddle's join page. */
export function showLiveNotification(ref: HuddleRef): boolean {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification('Your huddle is live', {
      body: `${ref.title} has started. Tap to join.`,
      tag: `huddle-live-${ref.id}`,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign(huddleJoinHref(ref.id));
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
