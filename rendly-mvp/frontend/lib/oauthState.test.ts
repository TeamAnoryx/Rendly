import { createOAuthState, verifyOAuthState, OAUTH_STATE_STORAGE_KEY } from './oauthState';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('OAuth state', () => {
  test('a state made in this tab verifies and names its provider and flow', () => {
    const storage = memoryStorage();
    expect(verifyOAuthState(createOAuthState('github_login', storage), storage)).toEqual({ provider: 'github', isLoginFlow: true });
    expect(verifyOAuthState(createOAuthState('linkedin', storage), storage)).toEqual({ provider: 'linkedin', isLoginFlow: false });
  });

  test('each attempt gets a fresh nonce and the older state stops working', () => {
    const storage = memoryStorage();
    const first = createOAuthState('github', storage);
    const second = createOAuthState('github', storage);
    expect(first).not.toBe(second);
    expect(verifyOAuthState(first, storage)).toBeNull();
    expect(verifyOAuthState(second, storage)).not.toBeNull();
  });

  test('a state from another tab or an attacker is rejected', () => {
    const victimTab = memoryStorage();
    const attackerState = createOAuthState('github_login', memoryStorage());
    expect(verifyOAuthState(attackerState, victimTab)).toBeNull();
    expect(verifyOAuthState(attackerState, memoryStorage({ [OAUTH_STATE_STORAGE_KEY]: 'other-nonce' }))).toBeNull();
  });

  test('blocked storage never throws: sign-in still redirects and the callback refuses', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('storage disabled');
      },
      setItem: (): void => {
        throw new Error('storage disabled');
      },
    };
    const state = createOAuthState('github', blocked);
    expect(state.startsWith('github.')).toBe(true);
    expect(verifyOAuthState(state, blocked)).toBeNull();
  });

  test('the old fixed values, malformed, empty and null states are rejected', () => {
    const storage = memoryStorage({ [OAUTH_STATE_STORAGE_KEY]: 'nonce' });
    expect(verifyOAuthState('github', storage)).toBeNull();
    expect(verifyOAuthState('github_login', storage)).toBeNull();
    expect(verifyOAuthState('github.', storage)).toBeNull();
    expect(verifyOAuthState('.nonce', storage)).toBeNull();
    expect(verifyOAuthState('twitter.nonce', storage)).toBeNull();
    expect(verifyOAuthState('', storage)).toBeNull();
    expect(verifyOAuthState(null, storage)).toBeNull();
  });
});
