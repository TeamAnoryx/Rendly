const emitWithAck = jest.fn();

jest.mock('@/services/websocket', () => ({
  __esModule: true,
  default: { emitWithAck: (...args: unknown[]) => emitWithAck(...args), on: jest.fn(() => () => undefined), emit: jest.fn() },
}));

import { notifyHuddleEnded } from '@/context/HuddleSessionContext';

describe('notifyHuddleEnded', () => {
  beforeEach(() => emitWithAck.mockReset());

  it('sends huddle:end with an ack and resolves true when the server confirms', async () => {
    emitWithAck.mockResolvedValue({ ok: true });
    await expect(notifyHuddleEnded('h1')).resolves.toBe(true);
    expect(emitWithAck).toHaveBeenCalledWith('huddle:end', { huddle_id: 'h1' });
  });

  it('resolves false when the server refuses', async () => {
    emitWithAck.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(notifyHuddleEnded('h1')).resolves.toBe(false);
  });

  it('resolves false on a timeout, offline socket or empty ack', async () => {
    emitWithAck.mockRejectedValueOnce(new Error('timeout'));
    await expect(notifyHuddleEnded('h1')).resolves.toBe(false);
    emitWithAck.mockResolvedValueOnce(undefined);
    await expect(notifyHuddleEnded('h1')).resolves.toBe(false);
  });
});
