'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import websocket from '@/services/websocket';
import { chat } from '@/services/chat';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export type CallState = 'idle' | 'ringing_outgoing' | 'ringing_incoming' | 'active';

export type IncomingCall = {
  conversation_id: string;
  call_type: string;
  initiator_id: string;
  call_log_id: string | null;
};

export type UseCallOptions = {
  onCallEnded?: (conversationId: string) => void;
};

type EndStatus = 'completed' | 'missed' | 'rejected' | 'cancelled';
type SdpPayload = { conversation_id: string; user_id: string; sdp: RTCSessionDescriptionInit };
type IcePayload = { conversation_id: string; user_id: string; candidate: RTCIceCandidateInit };

/** Turn a start-call failure into something the caller can act on. */
export function describeCallError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/offline|not online|callee_offline/i.test(msg)) return msg || "They're offline right now, so the call can't be placed.";
  if (/permission|NotAllowed/i.test(msg)) return 'Allow camera and microphone access to make calls.';
  if (/NotFound|device/i.test(msg)) return 'No camera or microphone was found.';
  return msg || 'The call could not be started.';
}

/**
 * 1:1 audio/video calls over WebRTC, signalled through the chat socket.
 *
 * Remote media: the first remote stream is the peer's camera/mic. A screen share arrives as a
 * second stream, and the sharer also sends call:screen with its stream id (and null when it
 * stops), so the receiver can show camera and screen side by side and drop back to the camera
 * view when sharing ends.
 */
export function useCall(currentUserId: string | null, options?: UseCallOptions) {
  const onCallEndedRef = useRef(options?.onCallEnded);
  onCallEndedRef.current = options?.onCallEnded;

  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [callLogId, setCallLogId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStreamState] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  // Refs mirror state so socket handlers never act on stale values.
  const stateRef = useRef<CallState>('idle');
  const convRef = useRef<string | null>(null);
  const logRef = useRef<string | null>(null);
  const typeRef = useRef<'audio' | 'video'>('video');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const screenSendersRef = useRef<RTCRtpSender[]>([]);
  const cameraStreamIdRef = useRef<string | null>(null);
  const remoteScreenIdRef = useRef<string | null>(null);
  const remoteCamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const isCallerRef = useRef(false);

  const setState = (s: CallState) => {
    stateRef.current = s;
    setCallState(s);
  };
  const setConv = (id: string | null) => {
    convRef.current = id;
    setConversationId(id);
  };
  const setLog = (id: string | null) => {
    logRef.current = id;
    setCallLogId(id);
  };

  const cleanupMedia = useCallback(() => {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    screenSendersRef.current = [];
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    remoteCamRef.current = null;
    remoteStreamsRef.current.clear();
    cameraStreamIdRef.current = null;
    remoteScreenIdRef.current = null;
    pendingIceRef.current = [];
    startedAtRef.current = null;
    isCallerRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setScreenStreamState(null);
    setRemoteScreenStream(null);
    setIsScreenSharing(false);
    setIsMuted(false);
    setIsVideoOff(false);
    setIncomingCall(null);
    setState('idle');
    setConv(null);
    setLog(null);
  }, []);

  const finish = useCallback(
    async (status: EndStatus) => {
      const convId = convRef.current;
      const logId = logRef.current;
      const started = startedAtRef.current;
      cleanupMedia();
      if (logId && currentUserId) {
        const duration = status === 'completed' && started != null ? Math.round((Date.now() - started) / 1000) : undefined;
        try {
          await chat.endCall(logId, status, duration);
        } catch (err) {
          console.warn('[call] could not record the call end', err);
        }
      }
      if (convId) onCallEndedRef.current?.(convId);
    },
    [cleanupMedia, currentUserId]
  );

  /** Decide which remote stream is camera and which is screen, then publish to state. */
  const publishRemote = useCallback(() => {
    const screenId = remoteScreenIdRef.current;
    let cam: MediaStream | null = null;
    let screen: MediaStream | null = null;
    const cameraId = cameraStreamIdRef.current;
    remoteStreamsRef.current.forEach((stream, id) => {
      if (stream.getTracks().length === 0) return;
      if (id === screenId) screen = stream;
      else if (!cameraId || id === cameraId) cam = cam ?? stream;
      else screen = screen ?? stream; // an extra stream without a marker is a screen share
    });
    // A fresh MediaStream object makes <video> elements pick up added tracks.
    setRemoteStream(cam ? new MediaStream((cam as MediaStream).getTracks()) : null);
    setRemoteScreenStream(screen);
  }, []);

  const createPeer = useCallback(
    (convId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate && currentUserId) websocket.emitWebrtcIceCandidate(convId, currentUserId, e.candidate.toJSON());
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        if (!cameraStreamIdRef.current && stream.id !== remoteScreenIdRef.current) cameraStreamIdRef.current = stream.id;
        remoteStreamsRef.current.set(stream.id, stream);
        const refresh = () => publishRemote();
        stream.onremovetrack = refresh;
        stream.onaddtrack = refresh;
        e.track.onended = refresh;
        e.track.onunmute = refresh;
        publishRemote();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          setCallError('The connection dropped.');
          void finish('completed');
        }
      };
      return pc;
    },
    [currentUserId, publishRemote, finish]
  );

  const getMedia = async (type: 'audio' | 'video'): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia(type === 'video' ? { audio: true, video: true } : { audio: true });
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  const flushIce = async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
  };

  // Signalling handlers. Registered once per user; they read refs, so they are never stale.
  useEffect(() => {
    if (!currentUserId) return;

    websocket.onCallIncoming((payload) => {
      if (stateRef.current !== 'idle') {
        // Busy: decline politely so the caller isn't left ringing.
        websocket.emitCallReject(payload.conversation_id, payload.call_log_id ?? undefined);
        return;
      }
      const type = payload.call_type === 'audio' ? 'audio' : 'video';
      typeRef.current = type;
      setCallType(type);
      setIncomingCall(payload);
      setConv(payload.conversation_id);
      setLog(payload.call_log_id);
      setState('ringing_incoming');
    });

    websocket.onCallAccepted(async (payload) => {
      const convId = convRef.current;
      if (!convId || convId !== payload.conversation_id || stateRef.current !== 'ringing_outgoing') return;
      if (!logRef.current && payload.call_log_id) setLog(payload.call_log_id);
      setState('active');
      startedAtRef.current = Date.now();
      try {
        const pc = createPeer(convId);
        const stream = await getMedia(typeRef.current);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        websocket.emitWebrtcOffer(convId, currentUserId, offer);
      } catch (err) {
        console.error('[call] caller setup failed', err);
        setCallError(describeCallError(err));
        websocket.emitCallEnd(convId, logRef.current ?? undefined, 'cancelled');
        void finish('cancelled');
      }
    });

    websocket.onCallRejected((payload) => {
      if (convRef.current !== payload.conversation_id) return;
      setCallError('The call was declined.');
      void finish('rejected');
    });

    websocket.onCallEnded((payload) => {
      if (convRef.current !== payload.conversation_id) return;
      void finish((payload.status as EndStatus) || 'completed');
    });

    websocket.onWebrtcOffer(async (payload: SdpPayload) => {
      const pc = pcRef.current;
      if (!pc || payload.conversation_id !== convRef.current || payload.user_id === currentUserId || !payload.sdp) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        websocket.emitWebrtcAnswer(payload.conversation_id, currentUserId, answer);
        publishRemote();
      } catch (err) {
        console.error('[call] handling offer failed', err);
      }
    });

    websocket.onWebrtcAnswer(async (payload: SdpPayload) => {
      const pc = pcRef.current;
      if (!pc || payload.conversation_id !== convRef.current || payload.user_id === currentUserId || !payload.sdp) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushIce(pc);
      } catch (err) {
        console.error('[call] handling answer failed', err);
      }
    });

    websocket.onWebrtcIceCandidate((payload: IcePayload) => {
      if (payload.conversation_id !== convRef.current || payload.user_id === currentUserId || !payload.candidate) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(payload.candidate);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => undefined);
    });

    const offScreen = websocket.on<{ conversation_id: string; stream_id: string | null }>('call:screen', (payload) => {
      if (payload.conversation_id !== convRef.current) return;
      remoteScreenIdRef.current = payload.stream_id;
      if (!payload.stream_id) {
        // Sharing stopped: forget every non-camera stream so the view returns to the camera.
        remoteStreamsRef.current.forEach((_s, id) => {
          if (id !== cameraStreamIdRef.current) remoteStreamsRef.current.delete(id);
        });
      }
      publishRemote();
    });

    return () => {
      offScreen();
    };
  }, [currentUserId, createPeer, finish, publishRemote]);

  const startCall = useCallback(
    async (convId: string, type: 'audio' | 'video') => {
      if (!currentUserId || stateRef.current !== 'idle') return;
      setCallError(null);
      isCallerRef.current = true;
      typeRef.current = type;
      setCallType(type);
      setConv(convId);
      setState('ringing_outgoing');
      try {
        const result = await chat.startCall(convId, type);
        const logId = result?.call_log_id ?? null;
        setLog(logId);
        websocket.emitCallStart(convId, type, currentUserId, logId ?? undefined);
      } catch (err) {
        setCallError(describeCallError(err));
        cleanupMedia();
      }
    },
    [currentUserId, cleanupMedia]
  );

  const acceptCall = useCallback(async () => {
    const inc = incomingCall;
    if (!inc || !currentUserId) return;
    setCallError(null);
    isCallerRef.current = false;
    const convId = inc.conversation_id;
    const type = inc.call_type === 'audio' ? 'audio' : 'video';
    setIncomingCall(null);
    setState('active');
    startedAtRef.current = Date.now();
    try {
      // Peer and media must be ready before the caller's offer arrives.
      const pc = createPeer(convId);
      const stream = await getMedia(type);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      websocket.emitCallAccept(convId, currentUserId, inc.call_log_id ?? undefined);
    } catch (err) {
      console.error('[call] accept failed', err);
      setCallError(describeCallError(err));
      websocket.emitCallReject(convId, inc.call_log_id ?? undefined);
      void finish('rejected');
    }
  }, [incomingCall, currentUserId, createPeer, finish]);

  const rejectCall = useCallback(() => {
    const inc = incomingCall;
    if (inc) websocket.emitCallReject(inc.conversation_id, inc.call_log_id ?? undefined);
    void finish('rejected');
  }, [incomingCall, finish]);

  const endCall = useCallback(() => {
    const convId = convRef.current;
    const status: EndStatus = stateRef.current === 'ringing_outgoing' ? 'cancelled' : 'completed';
    if (convId) websocket.emitCallEnd(convId, logRef.current ?? undefined, status);
    void finish(status);
  }, [finish]);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      localRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = m;
      });
      return !m;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setIsVideoOff((off) => {
      localRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = off;
      });
      return !off;
    });
  }, []);

  const renegotiate = useCallback(async () => {
    const pc = pcRef.current;
    const convId = convRef.current;
    if (!pc || !convId || !currentUserId) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    websocket.emitWebrtcOffer(convId, currentUserId, offer);
  }, [currentUserId]);

  const stopScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const stream = screenRef.current;
    const convId = convRef.current;
    if (!stream) return;
    screenRef.current = null;
    stream.getTracks().forEach((t) => t.stop());
    if (pc) screenSendersRef.current.forEach((s) => pc.getSenders().includes(s) && pc.removeTrack(s));
    screenSendersRef.current = [];
    setScreenStreamState(null);
    setIsScreenSharing(false);
    if (convId) websocket.emitScreenShare(convId, null);
    try {
      await renegotiate();
    } catch (err) {
      console.error('[call] renegotiate after screen share failed', err);
    }
  }, [renegotiate]);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const convId = convRef.current;
    if (!pc || !convId || !currentUserId) return;
    if (screenRef.current) {
      await stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = stream;
      setScreenStreamState(stream);
      setIsScreenSharing(true);
      // Announce first so the peer files the new stream as a screen, not a camera.
      websocket.emitScreenShare(convId, stream.id);
      screenSendersRef.current = stream.getTracks().map((t) => pc.addTrack(t, stream));
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (screenRef.current === stream) void stopScreenShare();
      });
      await renegotiate();
    } catch (err) {
      // Cancelling the browser picker lands here too; that is not an error worth showing.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        console.error('[call] screen share failed', err);
        setCallError('Screen sharing failed.');
      }
    }
  }, [currentUserId, renegotiate, stopScreenShare]);

  // Stop media if the provider unmounts mid-call (e.g. logout).
  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  const showScreenShareLayout = (isScreenSharing && !!screenStream) || !!remoteScreenStream;

  return {
    callState,
    callType,
    conversationId,
    callLogId,
    incomingCall,
    remoteStream,
    localStream,
    screenStream,
    remoteScreenStream,
    showScreenShareLayout,
    isMuted,
    isVideoOff,
    isScreenSharing,
    callError,
    clearCallError: () => setCallError(null),
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    cleanupMedia,
  };
}
