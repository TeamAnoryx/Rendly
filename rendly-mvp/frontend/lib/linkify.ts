/**
 * Splits chat text into plain text and links. Only http(s) URLs (and bare www. hosts) become
 * links, so `javascript:` and other schemes stay plain text. Links to a Rendly Huddle
 * (/dashboard/huddles/<id>) are flagged so the chat can show them as an invite.
 */
export type ChatToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'huddle'; text: string; href: string; huddleId: string };

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
/** Characters people put after a link that are not part of it. */
const TRAILING = /[.,!?;:)\]}'"]+$/;
const HUDDLE_RE = /\/dashboard\/huddles\/([A-Za-z0-9_-]{4,})\/?(?:[?#]|$)/;

export function huddleIdFromUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const match = HUDDLE_RE.exec(url.pathname + url.search + url.hash);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function linkify(text: string): ChatToken[] {
  const tokens: ChatToken[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let raw = match[1];
    const start = match.index ?? 0;
    const trail = TRAILING.exec(raw);
    if (trail) raw = raw.slice(0, raw.length - trail[0].length);
    if (!raw) continue;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    if (start > last) tokens.push({ kind: 'text', text: text.slice(last, start) });
    const huddleId = huddleIdFromUrl(href);
    tokens.push(huddleId ? { kind: 'huddle', text: raw, href, huddleId } : { kind: 'link', text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}
