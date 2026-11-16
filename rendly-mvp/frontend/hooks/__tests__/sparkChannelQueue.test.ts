const emit = jest.fn();
let resolveJoin: (v: { ok: boolean }) => void = () => undefined;
const emitWithAck = jest.fn(
  () =>
    new Promise<{ ok: boolean }>((resolve) => {
      resolveJoin = resolve;
    }),
);

jest.mock('@/services/websocket', () => ({
  __esModule: true,
  default: {
    emit: (...args: unknown[]) => emit(...args),
    emitWithAck: (...args: unknown[]) => emitWithAck(...(args as [])),
    isConnected: () => true,
    onStatus: () => () => undefined,
    on: () => () => undefined,
  },
}));

import { sparkChannel } from '../useSparkChannel';

const flush = () => new Promise((r) => setTimeout(r, 0));

test('signals and media sent before the join is acknowledged are delivered after it, not lost', async () => {
  sparkChannel.join();
  sparkChannel.media({ video: false, audio: false, p2p: false });
  sparkChannel.media({ video: true, audio: true, p2p: true });
  sparkChannel.signal('offer', { type: 'offer', sdp: 'v=0' });
  sparkChannel.signal('ice', { candidate: 'c1' });

  expect(emit).not.toHaveBeenCalledWith('spark:signal', expect.anything());
  expect(emit).not.toHaveBeenCalledWith('spark:media', expect.anything());

  resolveJoin({ ok: true });
  await flush();

  const sent = emit.mock.calls.map((c) => c[0]);
  expect(sent).toEqual(['spark:media', 'spark:signal', 'spark:signal']);
  // Only the latest media state is sent, then the signals in order.
  expect(emit.mock.calls[0][1]).toEqual({ video: true, audio: true, p2p: true });
  expect(emit.mock.calls[1][1]).toEqual({ kind: 'offer', data: { type: 'offer', sdp: 'v=0' } });

  // Once joined, signals go straight out.
  emit.mockClear();
  sparkChannel.signal('ice', { candidate: 'c2' });
  expect(emit).toHaveBeenCalledWith('spark:signal', { kind: 'ice', data: { candidate: 'c2' } });

  sparkChannel.leave('close');
});

test('a refused join keeps signals queued instead of sending them to a room the server ignores', async () => {
  emit.mockClear();
  sparkChannel.join();
  sparkChannel.signal('offer', { type: 'offer', sdp: 'v=0' });
  resolveJoin({ ok: false });
  await flush();
  expect(emit).not.toHaveBeenCalledWith('spark:signal', expect.anything());
  sparkChannel.leave('close');
});
