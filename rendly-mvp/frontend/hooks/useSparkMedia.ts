'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSparkIceConfig, type SparkIceConfig, type SparkMode } from '@/services/sparkApi';
import { sparkChannel, type SparkMediaState, type SparkSignal } from '@/hooks/useSparkChannel';
import type { PauseReason } from '@/lib/mediaPause';

type Kind = 'audio' | 'video';

type IceState = { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & SparkIceConfig);

/**
 * Whether the peer connection may exist yet.
 * - loading: fetching ICE config; unavailable: video cannot run (text chat still works)
 * - need-consent: direct connection only, and I am anonymous and have not allowed it
 * - declined: I chose text only
 * - waiting-partner: I allowed direct video, my anonymous match has not
 * - ready: the peer connection is (or is about to be) created
 */
/**
 * - idle: nobody has asked for video yet (no card)
 * - partner-wants-video: my match turned on camera/mic, I have not allowed a direct connection
 * - waiting-partner: my camera/mic is on, waiting for my match to allow it
 */
export type SparkVideoGate =
  | 'loading'
  | 'unavailable'
  | 'idle'
  | 'partner-wants-video'
  | 'declined'
  | 'waiting-partner'
  | 'ready';

const VIDEO_UNAVAILABLE = 'Video unavailable right now. You can still chat.';

export type SparkMediaApi = {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  partner: SparkMediaState;
  /** Partner publishes video and frames are arriving. */
  partnerVideoLive: boolean;
  connection: RTCPeerConnectionState | 'new';
  error: string | null;
  busy: Kind | null;
  toggleCam: () => void;
  toggleMic: () => void;
  /** I paused: my camera and mic are frozen for my match. */
  paused: boolean;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
  /** My match paused ('manual') or dropped and may come back ('away'). */
  partnerPaused: PauseReason | null;
  clearError: () => void;
  /** Explicit leave (skip / back). Safe to call more than once. */
  leave: (reason: string) => void;
  ended: boolean;
  /** Connection gate; no RTCPeerConnection or signalling exists until it is 'ready'. */
  videoGate: SparkVideoGate;
  /** Consent to a direct connection that can reveal my network address to my match. */
  allowDirect: () => void;
  /** Stay text only (no direct connection). */
  declineDirect: () => void;
};

function mediaErrorMessage(err: unknown, kind: Kind | 'both'): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const what = kind === 'video' ? 'camera' : kind === 'audio' ? 'microphone' : 'camera and microphone';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Access to your ${what} was blocked. Allow it in your browser settings and try again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${what} was found on this device.`;
    case 'NotReadableError':
    case 'AbortError':
      return `Your ${what} is being used by another app.`;
    default:
      return `Could not start your ${what}.`;
  }
}

function hasMediaDevices(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Owns the Spark room peer connection. One audio and one video transceiver are negotiated once at
 * room start; turning camera or mic on/off only swaps the sender track, so no renegotiation happens.
 * Only the initiator ever offers (no glare).
 */

/** How often an unconnected match is nudged to (re)negotiate. */
export const SPARK_CONNECT_NUDGE_MS = 2500;
/** A relay-only link that has not connected by now falls back to a direct (STUN) path. */
export const SPARK_RELAY_FALLBACK_MS = 10000;
const FALLBACK_STUN = 'stun:stun.l.google.com:19302';

export function useSparkMedia(opts: {
  initiator: boolean;
  myMode: SparkMode;
  /** I joined anonymously: never connect directly without my explicit consent. Defaults to true. */
  selfAnonymous?: boolean;
  /** My match joined anonymously: wait for their consent before a direct connection. Defaults to true. */
  partnerAnonymous?: boolean;
}): SparkMediaApi {
  const { initiator, myMode } = opts;
  const selfAnonymous = opts.selfAnonymous ?? true;
  const partnerAnonymous = opts.partnerAnonymous ?? true;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const tracksRef = useRef<{ audio: MediaStreamTrack | null; video: MediaStreamTrack | null }>({
    audio: null,
    video: null,
  });
  const remoteRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  /** Signals that arrive before our peer connection exists (consent / config still pending). */
  const earlySignalsRef = useRef<SparkSignal[]>([]);
  const offeredRef = useRef(false);
  const leftRef = useRef(false);
  const aliveRef = useRef(true);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [partner, setPartner] = useState<SparkMediaState>({ video: false, audio: false, p2p: false });
  const [ice, setIce] = useState<IceState>({ status: 'loading' });
  const [directChoice, setDirectChoice] = useState<'none' | 'allowed' | 'declined'>('none');
  const [pcReady, setPcReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [remoteVideoUnmuted, setRemoteVideoUnmuted] = useState(false);
  const [connection, setConnection] = useState<RTCPeerConnectionState | 'new'>('new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [ended, setEnded] = useState(false);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const [partnerManualPause, setPartnerManualPause] = useState(false);
  const [partnerAway, setPartnerAway] = useState(false);

  const myConsent = !selfAnonymous || directChoice === 'allowed';
  const partnerConsent = !partnerAnonymous || partner.p2p;
  const myConsentRef = useRef(myConsent);
  myConsentRef.current = myConsent;
  const partnerConsentRef = useRef(partnerConsent);
  partnerConsentRef.current = partnerConsent;
  /** Set once the relay-only path gave up and the link was reopened allowing direct routes. */
  const relayFallbackRef = useRef(false);
  const lastRestartRef = useRef(0);

  const stateRef = useRef<SparkMediaState>({ video: false, audio: false, p2p: myConsent });

  const transceiverFor = useCallback((kind: Kind): RTCRtpTransceiver | null => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === 'closed') return null;
    return (
      pc.getTransceivers().find((t) => t.currentDirection !== 'stopped' && t.receiver.track?.kind === kind) ?? null
    );
  }, []);

  /** Push the current local tracks onto whatever transceivers exist. */
  const attachTracks = useCallback(async () => {
    for (const kind of ['audio', 'video'] as Kind[]) {
      const t = transceiverFor(kind);
      if (!t) continue;
      const track = tracksRef.current[kind];
      if (t.sender.track === track) continue;
      try {
        await t.sender.replaceTrack(track);
      } catch {
        /* sender closed: room is ending */
      }
    }
  }, [transceiverFor]);

  const refreshLocal = useCallback(() => {
    const v = tracksRef.current.video;
    setLocalStream((prev) => (v ? (prev && prev.getVideoTracks()[0] === v ? prev : new MediaStream([v])) : null));
    setCamOn(!!v);
    setMicOn(!!tracksRef.current.audio);
  }, []);

  const publishState = useCallback(() => {
    const state = {
      video: !!tracksRef.current.video,
      audio: !!tracksRef.current.audio,
      p2p: myConsentRef.current,
      paused: pausedRef.current,
    };
    stateRef.current = state;
    sparkChannel.media(state);
  }, []);

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* stale candidate */
      }
    }
  }, []);

  const makeOffer = useCallback(
    async (restart = false) => {
      const pc = pcRef.current;
      if (!pc || !initiator || pc.signalingState !== 'stable') return;
      offeredRef.current = true;
      try {
        const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
        await pc.setLocalDescription(offer);
        sparkChannel.signal('offer', pc.localDescription?.toJSON() ?? offer);
      } catch {
        offeredRef.current = false;
        if (aliveRef.current) setError('Could not connect to your match. Try skipping to someone new.');
      }
    },
    [initiator],
  );

  /** Initiator offers the first time it hears from its partner (or re-offers if the link dropped). */
  const maybeOffer = useCallback(() => {
    if (!initiator) return;
    const pc = pcRef.current;
    if (!pc) return;
    if (!offeredRef.current) {
      void makeOffer(false);
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      void makeOffer(true);
    } else if (pc.signalingState === 'have-local-offer' && pc.localDescription && pc.connectionState !== 'connected') {
      // Still waiting for an answer: the offer may never have reached the partner. Send it again;
      // a repeated identical offer is answered the same way.
      sparkChannel.signal('offer', pc.localDescription.toJSON());
    }
  }, [initiator, makeOffer]);

  const handleSignal = useCallback(
    async (msg: SparkSignal) => {
      if (!msg || typeof msg !== 'object') return;
      const pc = pcRef.current;
      if (!pc) {
        // Not allowed to connect yet: hold the signal until the peer connection exists.
        if (!leftRef.current) earlySignalsRef.current.push(msg);
        return;
      }
      if (pc.signalingState === 'closed') return;
      try {
        if (msg.kind === 'offer' && !initiator) {
          const offer = msg.data as RTCSessionDescriptionInit;
          // A repeated offer (resent because our answer seemed lost): resend the same answer.
          if (
            pc.signalingState === 'stable' &&
            pc.remoteDescription?.sdp === offer.sdp &&
            pc.localDescription?.type === 'answer'
          ) {
            sparkChannel.signal('answer', pc.localDescription.toJSON());
            return;
          }
          // Mid-negotiation duplicate: the first copy is still being answered.
          if (pc.signalingState !== 'stable') return;
          await pc.setRemoteDescription(offer);
          pc.getTransceivers().forEach((t) => {
            if (t.currentDirection !== 'stopped' && t.direction !== 'stopped') t.direction = 'sendrecv';
          });
          await attachTracks();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sparkChannel.signal('answer', pc.localDescription?.toJSON() ?? answer);
          await flushIce(pc);
        } else if (msg.kind === 'answer' && initiator) {
          if (pc.signalingState !== 'have-local-offer') return;
          await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
          await flushIce(pc);
        } else if (msg.kind === 'ice' && msg.data) {
          const cand = msg.data as RTCIceCandidateInit;
          if (pc.remoteDescription) await pc.addIceCandidate(cand);
          else pendingIceRef.current.push(cand);
        }
      } catch {
        if (aliveRef.current && msg.kind !== 'ice') {
          setError('Could not connect to your match. Try skipping to someone new.');
        }
      }
    },
    [initiator, attachTracks, flushIce],
  );

  const stopLocal = useCallback(() => {
    (['audio', 'video'] as Kind[]).forEach((k) => {
      tracksRef.current[k]?.stop();
      tracksRef.current[k] = null;
    });
  }, []);

  const teardown = useCallback(() => {
    stopLocal();
    const pc = pcRef.current;
    pcRef.current = null;
    earlySignalsRef.current = [];
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
  }, [stopLocal]);

  /** Acquire one kind of track. Returns null (and sets a readable error) on failure. */
  const acquire = useCallback(async (kind: Kind): Promise<MediaStreamTrack | null> => {
    if (!hasMediaDevices()) {
      setError('This browser cannot use a camera or microphone here.');
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'video' ? { video: { facingMode: 'user' }, audio: false } : { audio: true, video: false },
      );
      return stream.getTracks().find((t) => t.kind === kind) ?? null;
    } catch (err) {
      setError(mediaErrorMessage(err, kind));
      return null;
    }
  }, []);

  const setTrack = useCallback(
    async (kind: Kind, on: boolean) => {
      if (on) {
        if (tracksRef.current[kind]) return;
        setBusy(kind);
        const track = await acquire(kind);
        setBusy(null);
        if (!track) return;
        if (!aliveRef.current || leftRef.current) {
          track.stop();
          return;
        }
        // Turning a device on while paused keeps it frozen until resume.
        track.enabled = !pausedRef.current;
        tracksRef.current[kind] = track;
        // Turning my camera or mic on is my consent to a direct connection.
        myConsentRef.current = true;
        setDirectChoice('allowed');
      } else {
        const track = tracksRef.current[kind];
        tracksRef.current[kind] = null;
        track?.stop();
      }
      await attachTracks();
      refreshLocal();
      publishState();
    },
    [acquire, attachTracks, refreshLocal, publishState],
  );

  // Peer connection + signalling lifecycle.
  useEffect(() => {
    aliveRef.current = true;
    leftRef.current = false;
    offeredRef.current = false;
    relayFallbackRef.current = false;
    pendingIceRef.current = [];

    let active = true;
    setPcReady(false);
    earlySignalsRef.current = [];
    if (typeof RTCPeerConnection === 'undefined') {
      setUnsupported(true);
      setError('Video is not supported in this browser. You can still chat.');
    } else {
      setIce({ status: 'loading' });
      getSparkIceConfig()
        .then((cfg) => {
          if (active) setIce({ status: 'ready', ...cfg });
        })
        .catch(() => {
          if (!active) return;
          setIce({ status: 'failed' });
          setError(VIDEO_UNAVAILABLE);
        });
    }

    const offs = [
      sparkChannel.on('spark:signal', (m) => void handleSignal(m)),
      sparkChannel.on('spark:media', (m) => {
        setPartner({ video: !!m?.video, audio: !!m?.audio, p2p: m?.p2p === true });
        setPartnerManualPause(m?.paused === true);
        maybeOffer();
      }),
      sparkChannel.on('spark:partner-paused', (p) => {
        if (p?.reason === 'manual') setPartnerManualPause(true);
        else setPartnerAway(true);
      }),
      sparkChannel.on('spark:partner-resumed', (p) => {
        if (p?.reason === 'manual') setPartnerManualPause(false);
        else setPartnerAway(false);
      }),
      sparkChannel.onJoined((ack) => setPartnerAway(ack.partner_paused === true)),
      sparkChannel.on('spark:partner-joined', () => {
        setPartnerAway(false);
        // Re-announce so a late joiner learns our state; the initiator offers on first contact.
        sparkChannel.media(stateRef.current);
        maybeOffer();
      }),
      sparkChannel.on('spark:ended', () => {
        leftRef.current = true;
        setEnded(true);
        teardown();
        setCamOn(false);
        setMicOn(false);
        setLocalStream(null);
      }),
      sparkChannel.onConnected(() => {
        if (leftRef.current) return;
        sparkChannel.join();
        sparkChannel.media(stateRef.current);
      }),
    ];

    sparkChannel.join();
    sparkChannel.media(stateRef.current);

    return () => {
      active = false;
      aliveRef.current = false;
      offs.forEach((off) => off());
      teardown();
      if (!leftRef.current) {
        leftRef.current = true;
        sparkChannel.scheduleLeave('close');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiator]);

  // Re-announce whenever my direct-connection consent changes.
  useEffect(() => {
    if (leftRef.current) return;
    publishState();
  }, [myConsent, publishState]);

  const canConnect =
    ice.status === 'ready' && !unsupported && (ice.relay || (myConsent && partnerConsent));

  // Create the peer connection only once connecting cannot leak an address without consent.
  useEffect(() => {
    if (!canConnect || ice.status !== 'ready' || pcRef.current || leftRef.current) return;
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(
        ice.relay
          ? { iceServers: ice.iceServers, iceTransportPolicy: 'relay' }
          : { iceServers: ice.iceServers },
      );
    } catch {
      setError(VIDEO_UNAVAILABLE);
      return;
    }
    pcRef.current = pc;
    if (initiator) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }
    const remote = new MediaStream();
    remoteRef.current = remote;
    setRemoteStream(remote);

    pc.ontrack = (ev) => {
      const track = ev.track;
      remote.getTracks()
        .filter((t) => t.kind === track.kind && t !== track)
        .forEach((t) => remote.removeTrack(t));
      if (!remote.getTracks().includes(track)) remote.addTrack(track);
      if (track.kind === 'video') {
        // A brief frame gap fires 'mute': only hide the partner's video if it stays muted.
        let muteTimer: ReturnType<typeof setTimeout> | null = null;
        setRemoteVideoUnmuted(!track.muted);
        track.onmute = () => {
          if (muteTimer) clearTimeout(muteTimer);
          muteTimer = setTimeout(() => aliveRef.current && track.muted && setRemoteVideoUnmuted(false), 1500);
        };
        track.onunmute = () => {
          if (muteTimer) clearTimeout(muteTimer);
          muteTimer = null;
          if (aliveRef.current) setRemoteVideoUnmuted(true);
        };
      }
      // Keep the same object while the track set is unchanged: a new stream resets the <video>.
      setRemoteStream((prev) =>
        prev && prev.getTracks().length === remote.getTracks().length && remote.getTracks().every((t) => prev.getTracks().includes(t))
          ? prev
          : new MediaStream(remote.getTracks()),
      );
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sparkChannel.signal('ice', ev.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (!aliveRef.current) return;
      setConnection(pc.connectionState);
      if (pc.connectionState === 'failed') maybeOffer();
    };
    setPcReady(true);

    void (async () => {
      await attachTracks();
      // Replay anything the partner sent while we were gated, in order.
      const early = earlySignalsRef.current;
      earlySignalsRef.current = [];
      for (const msg of early) await handleSignal(msg);
      // Tell the partner we are ready; the initiator offers now if the partner is already here.
      publishState();
      maybeOffer();
    })();
    // The pc is torn down by the lifecycle effect, leave() and the spark:ended handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConnect, ice]);

  // Connection watchdog: until the link is up, nudge every few seconds. The initiator re-sends
  // (or restarts) its offer; the other side re-announces itself so the initiator hears it. This
  // recovers an offer or answer that was sent before the partner's room socket was ready.
  useEffect(() => {
    if (!pcReady) return undefined;
    const id = setInterval(() => {
      const pc = pcRef.current;
      if (!pc || leftRef.current || pc.connectionState === 'connected') return;
      if (!initiator) {
        publishState();
        return;
      }
      // After the relay fallback, keep restarting ICE until a path works.
      if (relayFallbackRef.current && pc.signalingState === 'stable' && Date.now() - lastRestartRef.current > 8000) {
        lastRestartRef.current = Date.now();
        void makeOffer(true);
        return;
      }
      maybeOffer();
    }, SPARK_CONNECT_NUDGE_MS);
    return () => clearInterval(id);
  }, [pcReady, initiator, maybeOffer, publishState, makeOffer]);

  // Relay fallback: if TURN is unreachable or out of quota, a relay-only link never connects and
  // both sides sit on "Connecting…". Both people have already agreed to a direct connection
  // (camera on / direct consent), so reopen the link allowing direct routes and restart ICE.
  useEffect(() => {
    if (!pcReady || ice.status !== 'ready' || !ice.relay) return undefined;
    const timer = setTimeout(() => {
      void (async () => {
        const pc = pcRef.current;
        if (!pc || leftRef.current || relayFallbackRef.current) return;
        if (pc.connectionState === 'connected') return;
        if (!myConsentRef.current || !partnerConsentRef.current) return;
        try {
          pc.setConfiguration({
            iceServers: [...ice.iceServers, { urls: FALLBACK_STUN }],
            iceTransportPolicy: 'all',
          });
        } catch {
          return;
        }
        relayFallbackRef.current = true;
        if (!initiator) {
          publishState();
          return;
        }
        try {
          if (pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' });
        } catch {
          /* nothing to roll back */
        }
        lastRestartRef.current = Date.now();
        await makeOffer(true);
      })();
    }, SPARK_RELAY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [pcReady, ice, initiator, makeOffer, publishState]);

  // Video mode starts with camera + mic on; text mode starts with both off.
  useEffect(() => {
    if (myMode !== 'video') return;
    let cancelled = false;
    void (async () => {
      if (!hasMediaDevices()) {
        setError('This browser cannot use a camera or microphone here.');
        return;
      }
      setBusy('video');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        if (cancelled || !aliveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        tracksRef.current.video = stream.getVideoTracks()[0] ?? null;
        tracksRef.current.audio = stream.getAudioTracks()[0] ?? null;
      } catch (err) {
        if (cancelled) return;
        // Fall back to whichever single device works.
        setError(mediaErrorMessage(err, 'both'));
        const audio = await acquire('audio');
        if (cancelled || !aliveRef.current) {
          audio?.stop();
          return;
        }
        tracksRef.current.audio = audio;
      } finally {
        if (!cancelled) setBusy(null);
      }
      if (tracksRef.current.video || tracksRef.current.audio) {
        // Choosing video mode and starting the camera is my consent to a direct connection.
        myConsentRef.current = true;
        setDirectChoice('allowed');
      }
      await attachTracks();
      refreshLocal();
      publishState();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMode]);

  const toggleCam = useCallback(() => {
    if (busy || leftRef.current) return;
    void setTrack('video', !tracksRef.current.video);
  }, [busy, setTrack]);

  const toggleMic = useCallback(() => {
    if (busy || leftRef.current) return;
    void setTrack('audio', !tracksRef.current.audio);
  }, [busy, setTrack]);

  const leave = useCallback(
    (reason: string) => {
      if (!leftRef.current) {
        leftRef.current = true;
        sparkChannel.leave(reason);
      }
      teardown();
      setCamOn(false);
      setMicOn(false);
      setLocalStream(null);
    },
    [teardown],
  );

  const setPaused = useCallback(
    (next: boolean) => {
      if (leftRef.current || pausedRef.current === next) return;
      pausedRef.current = next;
      setPausedState(next);
      // Tracks that are on follow the pause; tracks that are off stay off.
      (['audio', 'video'] as Kind[]).forEach((k) => {
        const t = tracksRef.current[k];
        if (t) t.enabled = !next;
      });
      publishState();
    },
    [publishState],
  );
  const togglePause = useCallback(() => setPaused(!pausedRef.current), [setPaused]);

  const clearError = useCallback(() => setError(null), []);
  const allowDirect = useCallback(() => setDirectChoice('allowed'), []);
  const declineDirect = useCallback(() => setDirectChoice('declined'), []);

  let videoGate: SparkVideoGate;
  if (pcReady || canConnect) videoGate = 'ready';
  else if (unsupported || ice.status === 'failed') videoGate = 'unavailable';
  else if (ice.status === 'loading') videoGate = 'loading';
  else if (!myConsent) {
    const partnerWantsVideo = partner.video || partner.audio;
    if (!partnerWantsVideo) videoGate = 'idle';
    else videoGate = directChoice === 'declined' ? 'declined' : 'partner-wants-video';
  } else videoGate = camOn || micOn ? 'waiting-partner' : 'idle';

  const hasRemoteVideo = !!remoteStream?.getVideoTracks().some((t) => t.readyState === 'live');

  return {
    localStream,
    remoteStream,
    camOn,
    micOn,
    partner,
    partnerVideoLive: partner.video && hasRemoteVideo && remoteVideoUnmuted,
    connection,
    error,
    busy,
    toggleCam,
    toggleMic,
    paused,
    togglePause,
    setPaused,
    partnerPaused: partnerAway ? 'away' : partnerManualPause ? 'manual' : null,
    clearError,
    leave,
    ended,
    videoGate,
    allowDirect,
    declineDirect,
  };
}
