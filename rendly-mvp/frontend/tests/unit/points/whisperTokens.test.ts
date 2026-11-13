import { tokenTransferPreview } from '@/components/chat/TokenTransferCard';
import { parseTokenAmount } from '@/components/chat/SendTokensSheet';

jest.mock('@/lib/api', () => ({ authFetch: jest.fn() }));
jest.mock('@/services/chat', () => ({ chat: { sendMessage: jest.fn() } }));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => ({ pushToast: jest.fn() }) }));

describe('parseTokenAmount', () => {
  test('accepts positive whole numbers', () => {
    expect(parseTokenAmount('1')).toBe(1);
    expect(parseTokenAmount(' 250 ')).toBe(250);
  });

  test('rejects zero, negatives, decimals and junk', () => {
    expect(parseTokenAmount('0')).toBeNull();
    expect(parseTokenAmount('-5')).toBeNull();
    expect(parseTokenAmount('2.5')).toBeNull();
    expect(parseTokenAmount('abc')).toBeNull();
    expect(parseTokenAmount('')).toBeNull();
  });
});

describe('tokenTransferPreview', () => {
  test('labels sent and received transfers', () => {
    expect(tokenTransferPreview(10, true)).toBe('Sent 10 Rendly Tokens');
    expect(tokenTransferPreview(10, false)).toBe('Received 10 Rendly Tokens');
  });

  test('falls back to 0 for missing amounts', () => {
    expect(tokenTransferPreview(null, true)).toBe('Sent 0 Rendly Tokens');
    expect(tokenTransferPreview(Number('x'), false)).toBe('Received 0 Rendly Tokens');
  });
});
