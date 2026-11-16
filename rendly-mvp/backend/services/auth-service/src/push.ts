import webpush from "web-push";
import { supabase } from "./supabase-users";

/**
 * Web Push: stores browser subscriptions and sends "your huddle is live" pushes.
 * Disabled (every call is a no-op) until VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
 * VAPID_SUBJECT are set.
 */

const ENDPOINT_MAX = 1000;
const KEY_MAX = 200;
const PUSH_TTL_SECONDS = 60 * 60;

let configured: boolean | null = null;

function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    console.warn("[push] VAPID keys not set: web push disabled");
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  } catch (err) {
    console.error("[push] invalid VAPID configuration:", err);
    configured = false;
  }
  return configured;
}

/** Public VAPID key the browser needs to subscribe; null when push is disabled. */
export function vapidPublicKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY as string) : null;
}

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/** Browser push services (Chrome/Edge, Firefox, Windows, Safari). Other hosts are rejected (no SSRF). */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Validate a PushSubscription JSON body from the browser. */
export function parseSubscription(body: unknown): PushSubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
  const p256dh = typeof b.keys?.p256dh === "string" ? b.keys.p256dh : "";
  const auth = typeof b.keys?.auth === "string" ? b.keys.auth : "";
  if (endpoint.length > ENDPOINT_MAX || !isPushServiceEndpoint(endpoint)) return null;
  if (!p256dh || p256dh.length > KEY_MAX || !auth || auth.length > KEY_MAX) return null;
  return { endpoint, p256dh, auth };
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { onConflict: "endpoint" });
  if (error) throw new Error(`push subscription not saved: ${error.message}`);
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw new Error(`push subscription not deleted: ${error.message}`);
}

/** Remember that this user wants a push when the huddle goes live (e.g. they joined its waiting list). */
export async function addHuddlePushReminder(huddleId: string, userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("huddle_push_reminders")
    .upsert({ huddle_id: huddleId, user_id: userId }, { onConflict: "huddle_id,user_id" });
  if (error) throw new Error(`push reminder not saved: ${error.message}`);
}

type SubscriptionRow = { endpoint: string; p256dh: string; auth: string };

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/**
 * Send one push payload to every subscription of the given users. Only push-service hosts
 * are contacted (no SSRF); expired subscriptions (404/410) are removed. Throws only when
 * the subscriptions cannot be read; per-endpoint failures are logged.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!supabase || !pushConfigured() || userIds.length === 0) return;
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subErr) throw subErr;

  const body = JSON.stringify(payload);
  await Promise.all(
    ((subs ?? []) as SubscriptionRow[])
      .filter((s) => isPushServiceEndpoint(s.endpoint))
      .map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: PUSH_TTL_SECONDS,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            const { error: delErr } = (await supabase?.from("push_subscriptions").delete().eq("endpoint", s.endpoint)) ?? {};
            if (delErr) console.error("[push] expired subscription not removed:", delErr);
          } else {
            console.error("[push] send failed:", status ?? err);
          }
        }
      }),
  );
}

/** Send one push payload to every subscription of a single user. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  await sendPushToUsers([userId], payload);
}

/**
 * Push "your huddle is live" to everyone who asked for it, then clear their reminders.
 * Expired subscriptions (404/410) are removed. Never throws: callers fire and forget.
 */
export async function notifyHuddleLive(huddleId: string, title: string): Promise<void> {
  if (!supabase || !pushConfigured()) return;
  try {
    const { data: reminders, error } = await supabase
      .from("huddle_push_reminders")
      .select("user_id")
      .eq("huddle_id", huddleId);
    if (error) throw error;
    const userIds = (reminders ?? []).map((r: { user_id: string }) => r.user_id);
    if (userIds.length === 0) return;

    await sendPushToUsers(userIds, {
      title: "Your huddle is live",
      body: `${title} has started. Tap to join.`,
      url: `/dashboard/huddles/${huddleId}`,
      tag: `huddle-live-${huddleId}`,
    });
    const { error: clearErr } = await supabase.from("huddle_push_reminders").delete().eq("huddle_id", huddleId);
    if (clearErr) console.error("[push] reminders not cleared:", clearErr);
  } catch (err) {
    console.error("[push] huddle live notify failed:", err);
  }
}
