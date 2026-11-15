import { admitAllHuddleMembers } from './huddlesApi';
import { authFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authFetch: jest.fn() }));

const mockFetch = authFetch as jest.MockedFunction<typeof authFetch>;

function reply(ok: boolean): Response {
  const body = ok ? '{}' : JSON.stringify({ message: 'Forbidden' });
  return { ok, status: ok ? 200 : 403, text: async () => body } as unknown as Response;
}

describe('admitAllHuddleMembers', () => {
  beforeEach(() => mockFetch.mockReset());

  test('admits every waiting person with one request each', async () => {
    mockFetch.mockResolvedValue(reply(true));

    const result = await admitAllHuddleMembers('h1', ['a', 'b', 'c']);

    expect(result).toEqual({ admitted: 3, failed: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledWith('/api/huddles/h1/admit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ user_id: 'b' }) }));
  });

  test('keeps going when one admit fails and reports the count', async () => {
    mockFetch.mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(false)).mockResolvedValueOnce(reply(true));

    const result = await admitAllHuddleMembers('h1', ['a', 'b', 'c']);

    expect(result).toEqual({ admitted: 2, failed: 1 });
  });

  test('admits a single waiting person', async () => {
    mockFetch.mockResolvedValue(reply(true));
    expect(await admitAllHuddleMembers('h1', ['solo'])).toEqual({ admitted: 1, failed: 0 });
  });

  test('reports every failure when no one can be admitted', async () => {
    mockFetch.mockResolvedValue(reply(false));
    expect(await admitAllHuddleMembers('h1', ['a', 'b'])).toEqual({ admitted: 0, failed: 2 });
  });

  test('counts a network error as a failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply(true));
    expect(await admitAllHuddleMembers('h1', ['a', 'b'])).toEqual({ admitted: 1, failed: 1 });
  });

  test('does nothing for an empty waiting room', async () => {
    expect(await admitAllHuddleMembers('h1', [])).toEqual({ admitted: 0, failed: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
