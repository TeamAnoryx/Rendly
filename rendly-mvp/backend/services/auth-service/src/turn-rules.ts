/**
 * Spark ICE servers: short-lived TURN credentials (coturn "REST API" / use-auth-secret scheme)
 * so a match can be relayed and neither side learns the other's IP address.
 *
 *   username   = `${unixExpirySeconds}:${8 random hex chars}`
 *   credential = base64(HMAC-SHA1(sharedSecret, username))
 *
 * Pure: the clock, random suffix and env values are passed in. Never log the secret or the
 * credential.
 */

import crypto from "crypto";

export const TURN_CREDENTIAL_TTL_SECONDS = 10 * 60;
export const PUBLIC_STUN_URL = "stun:stun.l.google.com:19302";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type IceConfig = { relay: boolean; iceServers: IceServer[] };

/** Comma-separated TURN_URLS -> the turn:/turns: entries only (trimmed, deduplicated). */
export function parseTurnUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if (!/^turns?:[^\s]+$/i.test(url) || url.length > 512) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** coturn REST credential for a username: base64(HMAC-SHA1(secret, username)). */
export function turnCredential(secret: string, username: string): string {
  return crypto.createHmac("sha1", secret).update(username).digest("base64");
}

/** username = `${expiry}:${suffix}`, expiry = now + TTL in unix seconds. */
export function turnUsername(nowMs: number, suffixHex: string): string {
  const expiry = Math.floor(nowMs / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
  return `${expiry}:${suffixHex}`;
}

/**
 * ICE servers for a call. TURN_URLS + TURN_SHARED_SECRET gives short-lived relay credentials;
 * TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL gives a fixed relay login; otherwise STUN only.
 */
export function buildIceConfig(opts: {
  turnUrls: string | undefined | null;
  sharedSecret: string | undefined | null;
  /** Fixed TURN login (e.g. Metered, Twilio) used when no shared secret is set. */
  staticUsername?: string | undefined | null;
  staticCredential?: string | undefined | null;
  nowMs: number;
  randomHex8: string;
}): IceConfig {
  const urls = parseTurnUrls(opts.turnUrls);
  const secret = opts.sharedSecret ?? "";
  const staticUser = (opts.staticUsername ?? "").trim();
  const staticCred = (opts.staticCredential ?? "").trim();
  if (urls.length > 0 && secret.length === 0 && staticUser && staticCred) {
    return { relay: true, iceServers: [{ urls: PUBLIC_STUN_URL }, { urls, username: staticUser, credential: staticCred }] };
  }
  if (urls.length === 0 || secret.length === 0) {
    return { relay: false, iceServers: [{ urls: PUBLIC_STUN_URL }] };
  }
  const username = turnUsername(opts.nowMs, opts.randomHex8);
  return { relay: true, iceServers: [{ urls, username, credential: turnCredential(secret, username) }] };
}
