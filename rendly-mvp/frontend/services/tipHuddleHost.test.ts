import { tipHuddleHost } from './pointsApi';
import { authFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({ authFetch: jest.fn() }));

const mockFetch = authFetch as jest.MockedFunction<typeof authFetch>;

function response(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => body } as unknown as Response;
}

describe('tipHuddleHost', () => {
  afterEach(() => mockFetch.mockReset());

  test('posts the amount and note to the tip-host endpoint with an idempotency key', async () => {
    mockFetch.mockResolvedValue(response(201, { sent: 25, transfer_id: 't1' }));
    const result = await tipHuddleHost('h1', { amount: 25, note: 'thanks', idempotency_key: 'k1' });
    expect(result).toEqual({ sent: 25, transfer_id: 't1' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/huddles/h1/tip-host');
    expect(JSON.parse(String(init?.body))).toEqual({ amount: 25, note: 'thanks' });
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
  });

  test('surfaces the server message when the host is not receiving tokens', async () => {
    mockFetch.mockResolvedValue(response(403, { message: 'The host is not receiving tokens in this huddle' }));
    await expect(tipHuddleHost('h1', { amount: 5 })).rejects.toThrow('The host is not receiving tokens in this huddle');
  });
});
