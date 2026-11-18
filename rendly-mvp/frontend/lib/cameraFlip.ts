/**
 * Front/back camera switching for phones and tablets, shared by Whispers calls, Spark and huddles.
 * Phones usually allow only one open camera, so the old track is stopped before the other camera
 * is opened; if that fails the previous camera is reopened so the call never loses video.
 */

export type CameraFacing = 'user' | 'environment';

export interface CameraFlipResult {
  track: MediaStreamTrack;
  facing: CameraFacing;
  /** False when the other camera could not be opened and the previous one was restored. */
  switched: boolean;
}

export function nextFacing(facing: CameraFacing): CameraFacing {
  return facing === 'user' ? 'environment' : 'user';
}

/** Show the switch only on touch devices (phones and tablets) that can open a camera. */
export function canFlipCamera(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints ?? 0) > 0;
}

/** The self view is mirrored only for the front camera. */
export function mirrorFor(facing: CameraFacing): boolean {
  return facing === 'user';
}

export function cameraConstraints(facing: CameraFacing, base: MediaTrackConstraints | boolean = true): MediaTrackConstraints {
  const extra = typeof base === 'object' ? base : {};
  return { ...extra, facingMode: { ideal: facing } };
}

async function openCameraTrack(facing: CameraFacing, base: MediaTrackConstraints | boolean): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(facing, base), audio: false });
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No camera track was returned.');
  }
  return track;
}

/** Stop `old`, open the other camera, and keep the old track's on/off state. */
export async function flipCameraTrack(
  old: MediaStreamTrack | null,
  current: CameraFacing,
  base: MediaTrackConstraints | boolean = true,
): Promise<CameraFlipResult> {
  const enabled = old?.enabled ?? true;
  old?.stop();
  const target = nextFacing(current);
  try {
    const track = await openCameraTrack(target, base);
    track.enabled = enabled;
    return { track, facing: target, switched: true };
  } catch (err) {
    console.warn('[camera] could not switch camera', err instanceof Error ? err.message : err);
    const track = await openCameraTrack(current, base);
    track.enabled = enabled;
    return { track, facing: current, switched: false };
  }
}

/**
 * Put `next` in place of the stream's camera track: on every sender that carried the old track
 * and inside the stream itself, so the peer keeps the same stream.
 */
export async function swapCameraTrack(stream: MediaStream, old: MediaStreamTrack | null, next: MediaStreamTrack, senders: RTCRtpSender[]): Promise<void> {
  if (old) stream.removeTrack(old);
  stream.addTrack(next);
  await Promise.all(
    senders
      .filter((s) => old !== null && s.track === old)
      .map((s) =>
        s.replaceTrack(next).catch((err: unknown) => {
          console.warn('[camera] sender track swap failed', err instanceof Error ? err.message : err);
        }),
      ),
  );
}
