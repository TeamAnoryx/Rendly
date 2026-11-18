import { cameraConstraints, flipCameraTrack, mirrorFor, nextFacing, swapCameraTrack } from '../cameraFlip';

type FakeTrack = { kind: string; enabled: boolean; stop: jest.Mock; facing: string };

function fakeTrack(facing: string, enabled = true): FakeTrack {
  return { kind: 'video', enabled, stop: jest.fn(), facing };
}

function mockGetUserMedia(impl: (c: MediaStreamConstraints) => Promise<unknown>): jest.Mock {
  const fn = jest.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fn }, configurable: true });
  return fn;
}

function streamWith(track: FakeTrack) {
  return { getVideoTracks: () => [track], getTracks: () => [track] };
}

const facingOf = (c: MediaStreamConstraints) => ((c.video as MediaTrackConstraints).facingMode as { ideal: string }).ideal;

describe('cameraFlip', () => {
  it('alternates between the front and back camera', () => {
    expect(nextFacing('user')).toBe('environment');
    expect(nextFacing('environment')).toBe('user');
  });

  it('mirrors only the front camera', () => {
    expect(mirrorFor('user')).toBe(true);
    expect(mirrorFor('environment')).toBe(false);
  });

  it('keeps the base constraints and asks for the facing camera', () => {
    expect(cameraConstraints('environment', { width: { ideal: 1280 } })).toEqual({ width: { ideal: 1280 }, facingMode: { ideal: 'environment' } });
    expect(cameraConstraints('user')).toEqual({ facingMode: { ideal: 'user' } });
  });

  it('stops the old camera, opens the other one and keeps its on/off state', async () => {
    mockGetUserMedia(async (c) => streamWith(fakeTrack(facingOf(c))));
    const old = fakeTrack('user', false);
    const res = await flipCameraTrack(old as unknown as MediaStreamTrack, 'user');
    expect(old.stop).toHaveBeenCalled();
    expect(res.facing).toBe('environment');
    expect(res.switched).toBe(true);
    expect(res.track.enabled).toBe(false);
  });

  it('reopens the previous camera when the other one is unavailable', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gum = mockGetUserMedia(async (c) => {
      if (facingOf(c) === 'environment') throw new Error('NotFoundError');
      return streamWith(fakeTrack('user'));
    });
    const res = await flipCameraTrack(fakeTrack('user') as unknown as MediaStreamTrack, 'user');
    expect(gum).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ facing: 'user', switched: false });
  });

  it('throws when neither camera can be opened', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetUserMedia(async () => {
      throw new Error('NotReadableError');
    });
    await expect(flipCameraTrack(fakeTrack('user') as unknown as MediaStreamTrack, 'user')).rejects.toThrow('NotReadableError');
  });

  it('adds the new track when there was no camera and touches no sender', async () => {
    const next = fakeTrack('environment');
    const removeTrack = jest.fn();
    const addTrack = jest.fn();
    const sender = { track: null, replaceTrack: jest.fn() };
    await swapCameraTrack({ removeTrack, addTrack } as unknown as MediaStream, null, next as unknown as MediaStreamTrack, [sender] as unknown as RTCRtpSender[]);
    expect(removeTrack).not.toHaveBeenCalled();
    expect(addTrack).toHaveBeenCalledWith(next);
    expect(sender.replaceTrack).not.toHaveBeenCalled();
  });

  it('swaps the track on matching senders and in the stream', async () => {
    const old = fakeTrack('user');
    const next = fakeTrack('environment');
    const removeTrack = jest.fn();
    const addTrack = jest.fn();
    const camSender = { track: old, replaceTrack: jest.fn().mockResolvedValue(undefined) };
    const otherSender = { track: fakeTrack('screen'), replaceTrack: jest.fn().mockResolvedValue(undefined) };
    await swapCameraTrack(
      { removeTrack, addTrack } as unknown as MediaStream,
      old as unknown as MediaStreamTrack,
      next as unknown as MediaStreamTrack,
      [camSender, otherSender] as unknown as RTCRtpSender[],
    );
    expect(removeTrack).toHaveBeenCalledWith(old);
    expect(addTrack).toHaveBeenCalledWith(next);
    expect(camSender.replaceTrack).toHaveBeenCalledWith(next);
    expect(otherSender.replaceTrack).not.toHaveBeenCalled();
  });
});
