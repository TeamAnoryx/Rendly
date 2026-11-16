import { authFetch } from '@/lib/api';
import { withBasePath } from '@/lib/basePath';

/** Browser Web Push: registers the service worker and saves this browser's subscription server-side. */

const SW_PATH = withBasePath('/sw.js');

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchPublicKey(): Promise<string | null> {
  const res = await authFetch('/api/push/public-key');
  if (!res.ok) return null;
  const body = (await res.json()) as { public_key?: unknown };
  return typeof body.public_key === 'string' ? body.public_key : null;
}

/**
 * Subscribe this browser to push (permission must already be granted) and store it for the
 * signed-in user. Resolves false when push is unsupported, not allowed, or disabled server-side.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const key = await fetchPublicKey();
    if (!key) return false;
    const reg = await navigator.serviceWorker.register(SW_PATH);
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key) as BufferSource,
      }));
    const res = await authFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    return res.ok;
  } catch {
    return false;
  }
}
