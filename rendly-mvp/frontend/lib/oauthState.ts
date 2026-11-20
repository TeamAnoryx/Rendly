/**
 * OAuth `state` values. Each sign-in attempt carries a random nonce kept in this tab's
 * sessionStorage; the callback only accepts a state whose nonce matches. Without it, an
 * attacker could send a victim a callback link and sign them in to the attacker's account.
 */
export const OAUTH_STATE_STORAGE_KEY = 'rendly_oauth_state';

const FLOWS = ['github', 'github_login', 'linkedin', 'linkedin_login'] as const;
export type OAuthStateFlow = (typeof FLOWS)[number];

export interface ParsedOAuthState {
  provider: 'github' | 'linkedin';
  isLoginFlow: boolean;
}

const NONCE_BYTES = 16;

function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Make a state for this attempt and remember its nonce for the callback. */
export function createOAuthState(flow: OAuthStateFlow, storage: Pick<Storage, 'setItem'> = sessionStorage): string {
  const nonce = randomNonce();
  try {
    storage.setItem(OAUTH_STATE_STORAGE_KEY, nonce);
  } catch {
    // Storage blocked (private mode, quota): the redirect still happens and the callback,
    // finding no nonce, refuses the sign-in with a clear message instead of crashing here.
  }
  return `${flow}.${nonce}`;
}

/** The provider and flow named by `state`, or null when it is malformed or not from this tab. */
export function verifyOAuthState(state: string | null, storage: Pick<Storage, 'getItem'> = sessionStorage): ParsedOAuthState | null {
  if (!state) return null;
  const dot = state.indexOf('.');
  if (dot < 1) return null;
  const flow = state.slice(0, dot);
  const nonce = state.slice(dot + 1);
  if (!(FLOWS as readonly string[]).includes(flow)) return null;
  let expected: string | null = null;
  try {
    expected = storage.getItem(OAUTH_STATE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!expected || !nonce || nonce !== expected) return null;
  return { provider: flow.startsWith('github') ? 'github' : 'linkedin', isLoginFlow: flow.endsWith('_login') };
}
