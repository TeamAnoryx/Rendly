'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useCurrentUser } from '@/context/CurrentUserContext';
import websocket from '@/services/websocket';
import { useHasVideo } from '@/components/call/VideoTile';
import {
  admitHuddleMember,
  admitAllHuddleMembers,
  listHuddleMembers,
  removeHuddleMember,
  updateHuddleMember,
  updateHuddleSettings,
  type HuddleDetail,
  type HuddleMember,
  DEFAULT_HUDDLE_ICE_SERVERS,
  getHuddleIceServers,
} from '@/services/huddlesApi';
import {
  awardPoints,
  emitPointsChanged,
  notifyPointsPeers,
  getMyPoints,
  HUDDLE_SEND_PURPOSE_LABELS,
  HUDDLE_SEND_PURPOSES,
  newIdempotencyKey,
  sendHuddleTokens,
  type HuddleSendPurpose,
} from '@/services/pointsApi';
import { useNotifications } from '@/context/NotificationsContext';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import { TokenAmount, TokenCoin } from '@/components/brand/TokenCoin';
import RoomsPanel from './room/RoomsPanel';
import { ADMIN_ROOM, canManageRoom, ledRoom, matchesPerson, roleLabel, roomLabel } from './room/roomRules';
import { recordingFileName, useRoomRecorder, type RecordSource } from '@/hooks/useRoomRecorder';
import TipHostCard from './room/TipHostCard';
import PermissionPrompt from './room/PermissionPrompt';
import TokenEvent, { type TokenEventKind } from './room/TokenEvent';
import PersonMenu, { PersonMenuTrigger, type PersonMenuItem } from './room/PersonMenu';
import { PausedOverlay, useFreezeVideo, useFrozenWhile } from '@/components/call/OngoingCard';
import { applyPauseEvent, pauseLabel, pauseMapFromList, type PauseMap } from '@/lib/mediaPause';
import './huddle-room.css';

const MAIN_ROOM = 'main';
const MEMBERS_POLL_MS = 5000;
const ROOM_NAME = /^[a-z0-9][a-z0-9-]{0,19}$/;

type Role = 'host' | 'co_host' | 'participant';
type Peer = { cam: MediaStream | null; screen: MediaStream | null; screenId: string | null };
type ChatLine = { id: string; from: string; text: string; at: string; tokens?: { to: string; amount: number; kind: TokenEventKind } };
type Panel = 'people' | 'chat' | 'rooms' | 'host' | null;
type RewardFlags = { rewards_enabled: boolean; rewards_receive_enabled: boolean; tips_enabled: boolean };
const SEND_MIN = 1;
const SEND_MAX = 1000;
const SEND_NOTE_MAX = 140;
const SEND_QUICK_AMOUNTS = [25, 50, 100] as const;
type JoinAck = {
  ok: boolean;
  message?: string;
  peers?: string[];
  role?: Role;
  can_speak?: boolean;
  can_share_screen?: boolean;
  screens?: Record<string, string>;
  video_slot?: boolean;
  leaders?: Record<string, string>;
  recording?: string | null;
  /** People in this room who are paused (froze themselves, or reconnecting). */
  paused?: string[];
};

/** 75 -> "1:15" */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/** RMS level of a stream's audio, sampled for the active-speaker ring. */
function useSpeaking(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!enabled || !stream || stream.getAudioTracks().length === 0) {
      setSpeaking(false);
      return;
    }
    let ctx: AudioContext | null = null;
    let id: ReturnType<typeof setInterval> | null = null;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      id = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setSpeaking(Math.sqrt(sum / buf.length) > 0.04);
      }, 250);
    } catch {
      // Audio analysis is decoration; ignore failures.
    }
    return () => {
      if (id) clearInterval(id);
      ctx?.close().catch(() => undefined);
    };
  }, [stream, enabled]);
  return speaking;
}

function Tile({
  stream,
  name,
  avatarUrl,
  muted,
  mirror,
  badge,
  screen,
  camOff,
  micOff,
  pausedLabel = null,
}: {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  muted?: boolean;
  mirror?: boolean;
  badge?: string;
  screen?: boolean;
  camOff?: boolean;
  micOff?: boolean;
  /** "Paused" / "Reconnecting…": the tile holds its last frame under an overlay. */
  pausedLabel?: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frozen = !!pausedLabel;
  useFreezeVideo(ref, frozen, stream);
  const speaking = useSpeaking(stream, !screen);
  const hasVideo = useHasVideo(stream, !!screen);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream || !el.paused || frozen) return;
    // Mobile browsers can refuse to autoplay unmuted video; retry on the next tap.
    let retry: (() => void) | null = null;
    el.play().catch(() => {
      retry = () => void el.play().catch(() => undefined);
      document.addEventListener('pointerdown', retry, { once: true });
    });
    return () => {
      if (retry) document.removeEventListener('pointerdown', retry);
    };
  }, [stream, frozen]);
  const showVideo = useFrozenWhile(frozen, hasVideo && !camOff);
  return (
    <div className={`hr-tile ${speaking && !micOff ? 'hr-tile--speaking' : ''} ${screen ? 'hr-tile--screen' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'hr-mirror' : ''} style={{ opacity: showVideo ? 1 : 0, objectFit: screen ? 'contain' : 'cover' }} />
      {!showVideo ? (
        <div className="hr-tile-avatar">
          <Avatar url={avatarUrl} name={name} size="lg" />
        </div>
      ) : null}
      <span className="hr-tile-name">
        {micOff && !screen ? (
          <span className="hr-tile-mic" aria-label="Muted" role="img">
            <Icon name="mic-off" size={12} />
          </span>
        ) : null}
        <span className="hr-tile-label">{name}</span>
        {badge ? <em>{badge}</em> : null}
      </span>
      <PausedOverlay label={pausedLabel} />
    </div>
  );
}

export default function HuddleRoom({
  huddle,
  onLeave,
  onEnd,
  canLeave,
  paused = false,
  onTogglePause,
}: {
  huddle: HuddleDetail;
  onLeave: () => void;
  onEnd?: () => void;
  canLeave: boolean;
  /** I paused: my mic and camera are frozen for everyone (owned by HuddleSessionProvider). */
  paused?: boolean;
  onTogglePause?: () => void;
}) {
  const huddleId = huddle.id;
  // The host can make someone an admin mid-huddle, so the role follows the roster.
  const [role, setRole] = useState<Role>((huddle.your_role ?? 'participant') as Role);
  const isManager = role === 'host' || role === 'co_host';
  const { user } = useCurrentUser();
  const myId = user?.id ?? null;
  /**
   * Read by the WebRTC callbacks, which the setup effect captures once. Who offers first is
   * decided by comparing ids, so a stale null here meant nobody ever offered and no video flowed.
   */
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState(MAIN_ROOM);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  /** Whether this browser can capture the screen at all (iPhone/iPad and most phone browsers cannot). */
  const [canCapture, setCanCapture] = useState(true);
  useEffect(() => {
    setCanCapture(!!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
  }, []);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [canSpeak, setCanSpeak] = useState(huddle.your_permissions?.can_speak ?? true);
  // Admins can always share; others need the host's permission. Derived, so a promotion takes effect at once.
  const [sharePermitted, setCanShare] = useState(huddle.your_permissions?.can_share_screen ?? false);
  const canShare = isManager || sharePermitted;
  /** Slide-in prompt for permission grants (auto-hides after 3s). */
  const [grantPrompt, setGrantPrompt] = useState<string | null>(null);
  const closeGrantPrompt = useCallback(() => setGrantPrompt(null), []);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [members, setMembers] = useState<HuddleMember[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  /** Reward switches, kept locally so a host toggle in settings applies to the People panel at once. */
  const [rewardFlags, setRewardFlags] = useState<RewardFlags>({
    rewards_enabled: huddle.rewards_enabled !== false,
    rewards_receive_enabled: huddle.rewards_receive_enabled === true,
    tips_enabled: huddle.tips_enabled !== false,
  });
  const [unreadChat, setUnreadChat] = useState(0);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** room -> admin leading it. */
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  /** False when the main room is full for video: audio and chat only. */
  const [videoSlot, setVideoSlot] = useState(true);
  /** Who is recording this room, or null. */
  const [recordingBy, setRecordingBy] = useState<string | null>(null);
  /** Who in this room is paused or reconnecting. */
  const [pausedPeers, setPausedPeers] = useState<PauseMap>({});
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const pcs = useRef<Record<string, RTCPeerConnection>>({});
  /** STUN/TURN servers; loaded from the server before joining so peers behind NAT can connect. */
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_HUDDLE_ICE_SERVERS);
  const iceLoaded = useRef<Promise<void> | null>(null);
  const pendingIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const screenIds = useRef<Record<string, string | null>>({});
  const streamsByPeer = useRef<Record<string, Map<string, MediaStream>>>({});
  const camStreams = useRef<Record<string, MediaStream>>({});
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const screenSenders = useRef<Record<string, RTCRtpSender[]>>({});
  /** My camera sender per peer: it carries no track while my camera is off, so others see my avatar. */
  const camSenders = useRef<Record<string, RTCRtpSender>>({});
  const camOnRef = useRef(false);
  const roomRef = useRef(MAIN_ROOM);
  const panelRef = useRef<Panel>(null);
  panelRef.current = panel;

  /** The host, for the composer's "Send host tokens" button. */
  const chatHost = members.find((m) => m.role === 'host') ?? null;
  const nameOf = useCallback(
    (id: string) => {
      const m = members.find((x) => x.user_id === id);
      return m?.display_name || (m?.username ? `@${m.username}` : 'Guest');
    },
    [members]
  );
  const avatarOf = useCallback((id: string) => members.find((x) => x.user_id === id)?.avatar_url ?? null, [members]);

  // ---------- peers ----------
  const publishPeer = useCallback((id: string) => {
    const map = streamsByPeer.current[id];
    const screenId = screenIds.current[id] ?? null;
    let cam: MediaStream | null = null;
    let scr: MediaStream | null = null;
    map?.forEach((s, sid) => {
      if (s.getTracks().length === 0) return;
      if (screenId && sid === screenId) scr = s;
      else if (!cam && sid !== screenId) cam = s;
    });
    // Reuse the same MediaStream while its tracks are unchanged: a new object resets the <video>.
    const tracks = cam ? (cam as MediaStream).getTracks() : [];
    const prevCam = camStreams.current[id];
    const same =
      !!prevCam &&
      prevCam.getTracks().length === tracks.length &&
      tracks.every((t) => prevCam.getTracks().includes(t));
    const nextCam = tracks.length === 0 ? null : same ? prevCam : new MediaStream(tracks);
    if (nextCam) camStreams.current[id] = nextCam;
    else delete camStreams.current[id];
    setPeers((cur) => {
      const old = cur[id];
      if (old && old.cam === nextCam && old.screen === scr && old.screenId === screenId) return cur;
      return { ...cur, [id]: { cam: nextCam, screen: scr, screenId } };
    });
  }, []);

  const dropPeer = useCallback((id: string) => {
    pcs.current[id]?.close();
    delete pcs.current[id];
    delete pendingIce.current[id];
    delete streamsByPeer.current[id];
    delete camStreams.current[id];
    delete screenSenders.current[id];
    delete camSenders.current[id];
    setPeers((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const signal = useCallback(
    (to: string, data: unknown) => websocket.emit('huddle:signal', { huddle_id: huddleId, room: roomRef.current, to, data }),
    [huddleId]
  );

  const renegotiate = useCallback(
    async (id: string) => {
      const pc = pcs.current[id];
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(id, { type: 'offer', sdp: pc.localDescription?.sdp });
    },
    [signal]
  );

  const connectionFor = useCallback(
    (id: string): RTCPeerConnection => {
      const existing = pcs.current[id];
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcs.current[id] = pc;
      const l = localRef.current;
      if (l) {
        l.getTracks().forEach((t) => {
          const sender = pc.addTrack(t, l);
          if (t.kind === 'video') {
            camSenders.current[id] = sender;
            if (!camOnRef.current) void sender.replaceTrack(null).catch(() => undefined);
          }
        });
      } else {
        // No camera/mic: still receive everyone else.
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
      }
      const s = screenRef.current;
      if (s) screenSenders.current[id] = s.getTracks().map((t) => pc.addTrack(t, s));
      pc.onicecandidate = (e) => e.candidate && signal(id, { type: 'ice', candidate: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        (streamsByPeer.current[id] ??= new Map()).set(stream.id, stream);
        const refresh = () => publishPeer(id);
        stream.onaddtrack = refresh;
        stream.onremovetrack = refresh;
        e.track.onunmute = refresh;
        publishPeer(id);
      };
      // Either side may renegotiate (e.g. adding a screen); the lower id makes the first offer.
      pc.onnegotiationneeded = () => {
        const me = myIdRef.current;
        if (pc.signalingState === 'stable' && (pc.localDescription || (me && me < id))) void renegotiate(id);
      };
      // A failed path (often NAT on mobile networks) gets one ICE restart before the peer is dropped.
      let restarted = false;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return;
        if (!restarted && typeof pc.restartIce === 'function') {
          restarted = true;
          pc.restartIce();
          return;
        }
        dropPeer(id);
      };
      return pc;
    },
    [signal, publishPeer, renegotiate, dropPeer]
  );

  const handleSignal = useCallback(
    async (from: string, data: { type?: string; sdp?: string; candidate?: RTCIceCandidateInit }) => {
      const pc = connectionFor(from);
      try {
        if (data.type === 'offer' && data.sdp) {
          // Glare: if we were also offering, the higher id backs off.
          if (pc.signalingState === 'have-local-offer') {
            const me = myIdRef.current;
            if (me && me < from) return;
            await pc.setLocalDescription({ type: 'rollback' });
          }
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          for (const c of pendingIce.current[from] ?? []) await pc.addIceCandidate(c).catch(() => undefined);
          delete pendingIce.current[from];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(from, { type: 'answer', sdp: pc.localDescription?.sdp });
        } else if (data.type === 'answer' && data.sdp && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          for (const c of pendingIce.current[from] ?? []) await pc.addIceCandidate(c).catch(() => undefined);
          delete pendingIce.current[from];
        } else if (data.type === 'ice' && data.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
          else (pendingIce.current[from] ??= []).push(data.candidate);
        }
      } catch (err) {
        console.warn('[huddle] signal failed', err);
      }
    },
    [connectionFor, signal]
  );

  // ---------- rooms ----------
  const joinRoom = useCallback(
    async (name: string): Promise<boolean> => {
      if (!websocket.isConnected()) return false;
      try {
        iceLoaded.current ??= getHuddleIceServers(huddleId).then((servers) => {
          iceServersRef.current = servers;
        });
        await iceLoaded.current;
        const res = await websocket.emitWithAck<JoinAck>('huddle:join', { huddle_id: huddleId, room: name });
        if (!res?.ok) {
          setNotice(res?.message ?? 'Could not join the room');
          return false;
        }
        roomRef.current = name;
        setRoom(name);
        if (typeof res.can_speak === 'boolean') setCanSpeak(res.can_speak);
        if (typeof res.can_share_screen === 'boolean') setCanShare(res.can_share_screen);
        if (res.role) setRole(res.role);
        setLeaders(res.leaders ?? {});
        setVideoSlot(res.video_slot !== false);
        setRecordingBy(res.recording ?? null);
        setPausedPeers(pauseMapFromList(res.paused));
        // A rejoin (reconnect, room move) keeps my pause: tell the room again.
        if (pausedRef.current) websocket.emit('huddle:pause', { huddle_id: huddleId, room: name, paused: true });
        screenIds.current = { ...(res.screens ?? {}) };
        for (const id of res.peers ?? []) {
          setPeers((cur) => ({ ...cur, [id]: cur[id] ?? { cam: null, screen: null, screenId: null } }));
          connectionFor(id); // the lower id offers via negotiationneeded
        }
        setStatus('live');
        return true;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not join the room');
        return false;
      }
    },
    [huddleId, connectionFor]
  );

  const leaveRoom = useCallback(() => {
    websocket.emit('huddle:leave', { huddle_id: huddleId, room: roomRef.current });
    Object.keys(pcs.current).forEach(dropPeer);
    setPeers({});
  }, [huddleId, dropPeer]);

  const moveTo = useCallback(
    async (name: string) => {
      const prev = roomRef.current;
      leaveRoom();
      const ok = await joinRoom(name);
      if (!ok) await joinRoom(prev);
    },
    [leaveRoom, joinRoom]
  );

  // ---------- setup ----------
  // Join only once we know who we are: the id decides which side of each pair offers first.
  const myIdReady = !!myId;
  useEffect(() => {
    if (!myIdReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        s.getTracks().forEach((t) => (t.enabled = false)); // join with mic and camera off
        localRef.current = s;
        setLocal(s);
      } catch {
        setNotice('Camera and microphone are blocked. You can still watch and chat.');
      }
      if (!cancelled) await joinRoom(MAIN_ROOM);
    })();

    const offStatus = websocket.onStatus((c) => {
      if (!c) return;
      // Rooms live in server memory: rebuild the mesh after a reconnect.
      Object.keys(pcs.current).forEach(dropPeer);
      void joinRoom(roomRef.current);
    });
    const offs = [
      offStatus,
      websocket.on<{ user_id: string }>('huddle:peer-joined', ({ user_id }) => {
        // A returning peer (reconnect) builds new connections: drop the stale one first.
        if (pcs.current[user_id]) dropPeer(user_id);
        setPeers((cur) => ({ ...cur, [user_id]: cur[user_id] ?? { cam: null, screen: null, screenId: null } }));
        connectionFor(user_id);
      }),
      websocket.on<{ user_id: string }>('huddle:peer-left', ({ user_id }) => {
        dropPeer(user_id);
        setPausedPeers((cur) => applyPauseEvent(applyPauseEvent(cur, user_id, 'resumed', 'manual'), user_id, 'resumed'));
      }),
      websocket.on<{ user_id: string; reason?: string }>('huddle:peer-paused', ({ user_id, reason }) =>
        setPausedPeers((cur) => applyPauseEvent(cur, user_id, 'paused', reason)),
      ),
      websocket.on<{ user_id: string; reason?: string }>('huddle:peer-resumed', ({ user_id, reason }) =>
        setPausedPeers((cur) => applyPauseEvent(cur, user_id, 'resumed', reason)),
      ),
      websocket.on<{ from: string; data: { type?: string; sdp?: string; candidate?: RTCIceCandidateInit } }>('huddle:signal', ({ from, data }) => void handleSignal(from, data)),
      websocket.on<{ from: string; stream_id: string | null }>('huddle:screen', ({ from, stream_id }) => {
        screenIds.current[from] = stream_id;
        if (!stream_id) {
          const map = streamsByPeer.current[from];
          const camId = Array.from(map?.keys() ?? [])[0];
          map?.forEach((_s, sid) => sid !== camId && map.delete(sid));
        }
        publishPeer(from);
      }),
      websocket.on<{ from: string; text: string; at: string; room: string }>('huddle:chat', (m) => {
        if (m.room !== roomRef.current) return;
        setChat((c) => [...c, { id: `${m.at}_${m.from}_${c.length}`, from: m.from, text: m.text, at: m.at }].slice(-300));
        if (panelRef.current !== 'chat' && m.from !== myId) setUnreadChat((n) => n + 1);
      }),
      websocket.on<{ from: string; to: string; amount: number; at: string; room: string; kind?: TokenEventKind }>('huddle:tokens', (m) => {
        if (m.room !== roomRef.current) return;
        setChat((c) =>
          [...c, { id: `${m.at}_${m.from}_t${c.length}`, from: m.from, text: '', at: m.at, tokens: { to: m.to, amount: m.amount, kind: m.kind ?? 'transfer' } }].slice(-300),
        );
        if (m.to === myId) emitPointsChanged();
        if (panelRef.current !== 'chat' && m.from !== myId) setUnreadChat((n) => n + 1);
      }),
      websocket.on<{ muted: boolean }>('huddle:muted', ({ muted }) => {
        setMutedByHost(muted);
        if (muted) setNotice('You were muted by the host or your room leader.');
      }),
      websocket.on<{ leaders: Record<string, string> }>('huddle:leaders', ({ leaders: next }) => setLeaders(next ?? {})),
      websocket.on<{ room: string; has_slot: boolean }>('huddle:video-slot', ({ room: r, has_slot }) => {
        if (r !== roomRef.current || !has_slot) return;
        setVideoSlot(true);
        setNotice('A video spot opened. You can turn your camera on.');
      }),
      websocket.on<{ room: string; by: string | null }>('huddle:recording', ({ room: r, by }) => {
        if (r === roomRef.current) setRecordingBy(by);
      }),
      websocket.on<{ huddle_id: string; can_share_screen: boolean }>('huddle:permissions', ({ huddle_id, can_share_screen }) => {
        if (huddle_id !== huddleId) return;
        setCanShare(can_share_screen);
        if (can_share_screen) setGrantPrompt('The host has given you permission to share your screen.');
        else setNotice('Screen sharing was turned off for you.');
      }),
      websocket.on<{ huddle_id: string; role: Role }>('huddle:role', ({ huddle_id, role: next }) => {
        if (huddle_id !== huddleId) return;
        setRole(next);
        if (next === 'co_host') setGrantPrompt('You are now an admin. You can share your screen and manage people.');
        else setNotice('You are no longer an admin.');
      }),
      websocket.on<{ huddle_id: string; room: string }>('huddle:assigned', ({ huddle_id, room: next }) => {
        if (huddle_id !== huddleId || next === roomRef.current) return;
        setNotice(next === MAIN_ROOM ? 'You are back in the main room.' : `You were moved to ${roomLabel(next)}.`);
        void moveTo(next);
      }),
    ];

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      websocket.emit('huddle:leave', { huddle_id: huddleId, room: roomRef.current });
      Object.keys(pcs.current).forEach(dropPeer);
      localRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
    };
    // Set up once per huddle, as soon as the signed-in user is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huddleId, myIdReady]);

  // Mic/camera switches apply to the live tracks.
  useEffect(() => {
    const s = localRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = micOn && canSpeak && !mutedByHost && !paused));
    s.getVideoTracks().forEach((t) => (t.enabled = camOn && !paused));
    // Send no video at all while the camera is off or paused (a disabled track still sends black
    // frames; no track at all leaves the others on my last frame).
    const sending = camOn && !paused;
    camOnRef.current = sending;
    const cam = s.getVideoTracks()[0] ?? null;
    Object.values(camSenders.current).forEach((sender) => {
      void sender.replaceTrack(sending ? cam : null).catch((err: unknown) => {
        console.warn('[huddle] camera track switch failed', err instanceof Error ? err.message : err);
      });
    });
  }, [micOn, camOn, canSpeak, mutedByHost, local, paused]);

  // Tell the room when I pause or resume (not on first render).
  const announcedPause = useRef(false);
  useEffect(() => {
    if (announcedPause.current === paused) return;
    announcedPause.current = paused;
    websocket.emit('huddle:pause', { huddle_id: huddleId, room: roomRef.current, paused });
  }, [paused, huddleId]);

  // Roster (names, roles, permissions). Hosts also see the waiting list.
  const loadMembers = useCallback(async () => {
    try {
      const list = await listHuddleMembers(huddleId);
      setMembers(list);
      const me = list.find((m) => m.user_id === myId);
      if (me) setRole((cur) => (me.role === cur ? cur : (me.role as Role)));
      if (me) setCanShare(!!me.can_share_screen);
      if (me && !isManager) {
        setCanSpeak(me.can_speak);
        // The saved mute state is the source of truth; the socket event only makes it instant.
        setMutedByHost(me.is_muted);
      }
    } catch (err) {
      console.warn('[huddle] members unavailable', err);
    }
  }, [huddleId, myId, isManager]);
  useEffect(() => {
    void loadMembers();
    const id = setInterval(() => void loadMembers(), MEMBERS_POLL_MS);
    return () => clearInterval(id);
  }, [loadMembers]);

  // Losing share permission stops an active share.
  const stopShare = useCallback(async () => {
    const s = screenRef.current;
    if (!s) return;
    screenRef.current = null;
    s.getTracks().forEach((t) => t.stop());
    setScreen(null);
    websocket.emit('huddle:screen', { huddle_id: huddleId, room: roomRef.current, stream_id: null });
    for (const [id, senders] of Object.entries(screenSenders.current)) {
      const pc = pcs.current[id];
      senders.forEach((snd) => pc?.getSenders().includes(snd) && pc.removeTrack(snd));
      delete screenSenders.current[id];
    }
  }, [huddleId]);
  useEffect(() => {
    if (!canShare && screenRef.current) void stopShare();
  }, [canShare, stopShare]);

  const startShare = async () => {
    if (screenRef.current) return stopShare();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('huddle:screen', { huddle_id: huddleId, room: roomRef.current, stream_id: s.id });
      if (!res?.ok) {
        s.getTracks().forEach((t) => t.stop());
        setNotice(res?.message ?? 'You cannot share right now');
        return;
      }
      screenRef.current = s;
      setScreen(s);
      for (const [id, pc] of Object.entries(pcs.current)) screenSenders.current[id] = s.getTracks().map((t) => pc.addTrack(t, s));
      s.getVideoTracks()[0]?.addEventListener('ended', () => void stopShare());
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) setNotice('Screen sharing failed.');
    }
  };

  const sendChat = () => {
    const text = draft.trim();
    if (!text) return;
    if (!websocket.isConnected()) {
      setNotice('Not connected — your message was not sent. It will stay in the box until you reconnect.');
      return;
    }
    websocket.emit('huddle:chat', { huddle_id: huddleId, room: roomRef.current, text });
    setDraft('');
  };

  useEffect(() => {
    if (panel === 'chat') setUnreadChat(0);
  }, [panel]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // ---------- layout ----------
  const peerIds = Object.keys(peers);
  const sharer = screen ? myId : peerIds.find((id) => peers[id].screen) ?? null;
  const shareStream = screen ?? (sharer ? peers[sharer]?.screen ?? null : null);
  const tileCount = peerIds.length + 1;
  const gridClass = tileCount <= 1 ? 'hr-grid--1' : tileCount <= 2 ? 'hr-grid--2' : tileCount <= 4 ? 'hr-grid--4' : tileCount <= 6 ? 'hr-grid--6' : 'hr-grid--9';
  const meName = members.find((m) => m.user_id === myId)?.display_name || 'You';
  const micLive = micOn && canSpeak && !mutedByHost;
  /** People in the waiting room; only managers can admit them, so only they see the count. */
  const waitingCount = isManager ? members.filter((m) => !m.admitted).length : 0;
  const panelTitle = panel === 'people' ? 'People' : panel === 'chat' ? `Chat · ${room}` : panel === 'rooms' ? 'Breakout rooms' : 'Host settings';

  const myLedRoom = ledRoom(leaders, myId);
  const canManageHere = canManageRoom(role, myId, room, leaders);
  const recordSources = useRef<() => RecordSource[]>(() => []);
  recordSources.current = () => [
    { id: 'me', stream: local, name: meName },
    ...peerIds.map((id) => ({ id, stream: peers[id].cam, name: nameOf(id) })),
    ...(shareStream ? [{ id: 'screen', stream: shareStream, name: sharer === myId ? 'Your screen' : `${nameOf(sharer ?? '')}'s screen`, screen: true }] : []),
  ];
  const recorder = useRoomRecorder(() => recordSources.current());
  const recordedRoom = useRef<string | null>(null);
  const { recording: isRecording, stop: stopRecording, error: recordError, clearError: clearRecordError } = recorder;

  // Moving to another room ends (and saves) my recording of the old one.
  useEffect(() => {
    if (isRecording && recordedRoom.current !== room) stopRecording();
  }, [room, isRecording, stopRecording]);
  useEffect(() => {
    if (!recordError) return;
    setNotice(recordError);
    clearRecordError();
  }, [recordError, clearRecordError]);
  // No video slot in a full main room: keep the camera off.
  useEffect(() => {
    if (!videoSlot) setCamOn(false);
  }, [videoSlot]);

  const toggleRecord = async () => {
    if (isRecording) {
      stopRecording();
      websocket.emit('huddle:recording', { huddle_id: huddleId, room: roomRef.current, on: false });
      return;
    }
    try {
      const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('huddle:recording', { huddle_id: huddleId, room: roomRef.current, on: true });
      if (!res?.ok) {
        setNotice(res?.message ?? 'Could not start recording');
        return;
      }
      recordedRoom.current = roomRef.current;
      const started = await recorder.start(recordingFileName(huddle.title, roomRef.current, new Date()));
      if (!started) websocket.emit('huddle:recording', { huddle_id: huddleId, room: roomRef.current, on: false });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start recording');
    }
  };
  const someoneElseRecording = !!recordingBy && recordingBy !== myId;

  const tiles = (
    <>
      <Tile stream={local} name={`${meName} (you)`} avatarUrl={user?.avatar_url} muted mirror camOff={!camOn} micOff={!micLive} badge={role !== 'participant' ? roleLabel(role) : undefined} pausedLabel={paused ? 'Paused' : null} />
      {peerIds.map((id) => {
        const m = members.find((x) => x.user_id === id);
        return <Tile key={id} stream={peers[id].cam} name={nameOf(id)} avatarUrl={avatarOf(id)} micOff={m?.is_muted === true} badge={m?.role === 'host' || m?.role === 'co_host' ? roleLabel(m.role) : undefined} pausedLabel={pauseLabel(pausedPeers[id])} />;
      })}
    </>
  );

  return (
    <div className={`hr ${panel ? 'hr--panel' : ''}`}>
      <div className="hr-stage">
        <header className="hr-topline">
          <span className="rd-badge rd-badge--live">LIVE</span>
          <strong className="hr-title">{huddle.title}</strong>
          <span className="hr-count rd-mono" aria-label={`${tileCount} in this room`}>
            <Icon name="people" size={13} /> {tileCount}
          </span>
          {room !== MAIN_ROOM ? <span className="rd-chip rd-chip--on hr-room-chip">{roomLabel(room)}</span> : null}
          {recordingBy ? (
            <span className="hr-rec" role="status" aria-label={recordingBy === myId ? 'You are recording this room' : 'This room is being recorded'}>
              <span className="hr-rec-dot" aria-hidden="true" />
              REC{recordingBy === myId && isRecording ? <span className="rd-mono"> {clock(recorder.seconds)}</span> : null}
            </span>
          ) : null}
          {status === 'connecting' ? (
            <span className="hr-connecting rd-small rd-muted" role="status">
              <span className="rd-spinner" /> Connecting…
            </span>
          ) : null}
          {room !== MAIN_ROOM && (isManager || huddle.allow_self_exit !== false) ? (
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm hr-back-main" onClick={() => void moveTo(MAIN_ROOM)}>
              <Icon name="door" size={14} /> Back to main room
            </button>
          ) : null}
        </header>
        {notice ? <div className="hr-notice" role="status">{notice}</div> : null}
      <PermissionPrompt message={grantPrompt} onClose={closeGrantPrompt} />
        {error ? <div className="hr-notice hr-notice--error" role="alert">{error}</div> : null}

        <div className="hr-canvas">
          {shareStream ? (
            <div className="hr-share">
              <Tile stream={shareStream} name={sharer === myId ? 'Your screen' : `${nameOf(sharer ?? '')}'s screen`} screen muted />
              <div className="hr-filmstrip rd-scroll">{tiles}</div>
            </div>
          ) : (
            <div className={`hr-grid ${gridClass}`}>{tiles}</div>
          )}
        </div>

        <div className="hr-controls" role="toolbar" aria-label="Huddle controls">
          <button type="button" className={`rd-icon-btn hr-dock-btn ${micLive ? '' : 'hr-dock-btn--off'}`} disabled={!local || !canSpeak} onClick={() => { setMicOn((v) => !v); if (mutedByHost) setMutedByHost(false); }} title={canSpeak ? 'Microphone' : 'The host has not let you speak yet'} aria-label="Microphone" aria-pressed={micLive}>
            <Icon name={micLive ? 'mic' : 'mic-off'} />
          </button>
          <button type="button" className={`rd-icon-btn hr-dock-btn ${camOn ? '' : 'hr-dock-btn--off'}`} disabled={!local || !videoSlot} onClick={() => setCamOn((v) => !v)} aria-label="Camera" title={videoSlot ? 'Camera' : 'The main room is full for video. Audio and chat only, or join a breakout room.'} aria-pressed={camOn}>
            <Icon name={camOn ? 'video' : 'video-off'} />
          </button>
          <button type="button" className={`rd-icon-btn hr-dock-btn ${screen ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`} disabled={!canShare || !canCapture} onClick={() => void startShare()} aria-label="Share screen" title={!canCapture ? "Screen sharing isn't supported by this browser" : canShare ? 'Share screen' : 'Ask the host for permission to share'} aria-pressed={!!screen}>
            <Icon name="screen" />
          </button>
          {canManageHere ? (
            <button
              type="button"
              className={`rd-icon-btn hr-dock-btn hr-dock-rec ${isRecording ? 'hr-dock-rec--on' : ''}`}
              onClick={() => void toggleRecord()}
              disabled={someoneElseRecording}
              aria-label={isRecording ? 'Stop recording' : 'Record this room'}
              title={someoneElseRecording ? 'Someone is already recording this room' : isRecording ? 'Stop and save the recording' : 'Record this room (saves to your device)'}
              aria-pressed={isRecording}
            >
              <Icon name="record" />
            </button>
          ) : null}
          {onTogglePause ? (
            <button type="button" className={`rd-icon-btn hr-dock-btn ${paused ? 'hr-dock-btn--off' : ''}`} onClick={onTogglePause} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume your camera and mic' : 'Pause your camera and mic'} aria-pressed={paused}>
              <Icon name={paused ? 'play' : 'pause'} />
            </button>
          ) : null}
          <span className="hr-controls-sep" aria-hidden="true" />
          <button type="button" className={`rd-icon-btn hr-dock-btn ${panel === 'chat' ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} aria-label="Chat" title="Chat" aria-pressed={panel === 'chat'}>
            <Icon name="chat" />
            {unreadChat > 0 ? <span className="rd-count hr-dock-count">{unreadChat}</span> : null}
          </button>
          <button type="button" className={`rd-icon-btn hr-dock-btn ${panel === 'people' ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label={waitingCount > 0 ? `People, ${waitingCount} waiting` : 'People'} title="People" aria-pressed={panel === 'people'}>
            <Icon name="people" />
            {waitingCount > 0 ? <span className="rd-count hr-dock-count" aria-hidden="true">{waitingCount}</span> : null}
          </button>
          {isManager ? (
            <>
              <button type="button" className={`rd-icon-btn hr-dock-btn ${panel === 'rooms' ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`} onClick={() => setPanel(panel === 'rooms' ? null : 'rooms')} aria-label="Breakout rooms" title="Breakout rooms" aria-pressed={panel === 'rooms'}>
                <Icon name="grid" />
              </button>
              <button
                type="button"
                className={`rd-icon-btn hr-dock-btn ${room === ADMIN_ROOM ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`}
                onClick={() => void moveTo(room === ADMIN_ROOM ? myLedRoom ?? MAIN_ROOM : ADMIN_ROOM)}
                aria-label={room === ADMIN_ROOM ? 'Back to your room' : 'Admin room'}
                title={room === ADMIN_ROOM ? `Back to ${roomLabel(myLedRoom ?? MAIN_ROOM)}` : 'Admin room (host and admins only)'}
                aria-pressed={room === ADMIN_ROOM}
              >
                <Icon name="shield" />
              </button>
              <button type="button" className={`rd-icon-btn hr-dock-btn ${panel === 'host' ? 'rd-icon-btn--on hr-dock-btn--on' : ''}`} onClick={() => setPanel(panel === 'host' ? null : 'host')} aria-label="Host settings" title="Host settings" aria-pressed={panel === 'host'}>
                <Icon name="settings" />
              </button>
            </>
          ) : null}
          <span className="hr-controls-sep" aria-hidden="true" />
          <button
            type="button"
            className="rd-icon-btn rd-icon-btn--danger hr-dock-btn hr-dock-leave"
            onClick={onLeave}
            disabled={!canLeave}
            aria-label="Leave huddle"
            title={canLeave ? 'Leave' : 'The host controls when people leave'}
          >
            <Icon name="phone-off" />
          </button>
          {role === 'host' && onEnd ? (
            <button type="button" className="rd-btn rd-btn--danger rd-btn--sm hr-end-all" onClick={onEnd}>
              End for all
            </button>
          ) : null}
        </div>
      </div>

      {panel ? <div className="hr-scrim" aria-hidden="true" onClick={() => setPanel(null)} /> : null}
      {panel ? (
        <aside className="hr-panel" aria-label={panelTitle}>
          <span className="hr-panel-grip" aria-hidden="true" />
          <header className="hr-panel-head">
            <strong>{panelTitle}</strong>
            <button type="button" className="rd-icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
              <Icon name="close" size={16} />
            </button>
          </header>
          {panel === 'people' ? <PeoplePanel huddle={huddle} flags={rewardFlags} members={members} myId={myId} isManager={isManager} isHost={role === 'host'} onChanged={loadMembers} peersInRoom={peerIds} room={room} canManageHere={canManageHere} leaders={leaders} /> : null}
          {panel === 'chat' ? (
            <div className="hr-chat">
              <div className="hr-chat-list rd-scroll" aria-live="polite">
                {chat.length === 0 ? <p className="rd-small rd-muted">Messages go to everyone in this room.</p> : null}
                {chat.map((c) =>
                  c.tokens ? (
                    <TokenEvent
                      key={c.id}
                      kind={c.tokens.kind}
                      amount={c.tokens.amount}
                      fromName={c.from === myId ? 'You' : nameOf(c.from)}
                      toName={c.tokens.to === myId ? 'You' : nameOf(c.tokens.to)}
                      fromAvatar={avatarOf(c.from)}
                      toAvatar={avatarOf(c.tokens.to)}
                    />
                  ) : (
                  <div key={c.id} className={`hr-chat-line ${c.from === myId ? 'hr-chat-line--me' : ''}`}>
                    <span className="hr-chat-from">{c.from === myId ? 'You' : nameOf(c.from)}</span>
                    <p>{c.text}</p>
                  </div>
                  ),
                )}
              </div>
              <form className="hr-chat-input" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
                {role !== 'host' && rewardFlags.tips_enabled && chatHost && chatHost.user_id !== myId ? (
                  <TipHostCard
                    variant="composer"
                    huddleId={huddleId}
                    room={room}
                    hostId={chatHost.user_id}
                    hostName={chatHost.display_name || (chatHost.username ? `@${chatHost.username}` : 'the host')}
                  />
                ) : null}
                <input className="rd-input" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="Message the room" aria-label="Message" />
                <button type="submit" className="rd-icon-btn" disabled={!draft.trim()} aria-label="Send">
                  <Icon name="send" size={16} />
                </button>
              </form>
            </div>
          ) : null}
          {panel === 'rooms' && isManager ? <RoomsPanel huddleId={huddleId} members={members} myId={myId} role={role} currentRoom={room} leaders={leaders} onPeek={(r) => void moveTo(r)} /> : null}
          {panel === 'host' && isManager ? <HostSettings huddle={huddle} isHost={role === 'host'} flags={rewardFlags} onFlagsChange={setRewardFlags} /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function PeoplePanel({
  huddle,
  flags,
  members,
  myId,
  isManager,
  isHost,
  onChanged,
  peersInRoom,
  room,
  canManageHere,
  leaders,
}: {
  huddle: HuddleDetail;
  flags: RewardFlags;
  members: HuddleMember[];
  myId: string | null;
  isManager: boolean;
  isHost: boolean;
  onChanged: () => Promise<void>;
  peersInRoom: string[];
  room: string;
  /** Host, or the admin leading this room: may mute and allow sharing here. */
  canManageHere: boolean;
  leaders: Record<string, string>;
}) {
  const { pushToast } = useNotifications();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [awardFor, setAwardFor] = useState<string | null>(null);
  const [amount, setAmount] = useState(50);
  const [note, setNote] = useState('');
  const [sendFor, setSendFor] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState(50);
  const [sendPurpose, setSendPurpose] = useState<HuddleSendPurpose>('winner');
  const [sendNote, setSendNote] = useState('');
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const canSendTokens = isHost && flags.rewards_receive_enabled;
  const waiting = members.filter((m) => !m.admitted);
  const inRoom = members.filter((m) => m.admitted);
  const hostMember = inRoom.find((m) => m.role === 'host') ?? null;
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const reduceMotion = useReducedMotion();
  /** One participant's action menu is open at a time. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const closeMenu = () => {
    setMenuFor(null);
    setAwardFor(null);
    setSendFor(null);
  };
  const toggleMenu = (id: string) => {
    if (menuFor === id) {
      closeMenu();
      return;
    }
    setAwardFor(null);
    setSendFor(null);
    setMenuFor(id);
  };
  // A search moves matching people to the top (with a highlight) instead of hiding everyone else.
  const matchIds = new Set(
    searching ? inRoom.filter((m) => matchesPerson(query, m.display_name, m.username)).map((m) => m.user_id) : [],
  );
  const shown = searching
    ? [...inRoom.filter((m) => matchIds.has(m.user_id)), ...inRoom.filter((m) => !matchIds.has(m.user_id))]
    : inRoom;
  const leadOf = (id: string) => Object.entries(leaders).find(([, lead]) => lead === id)?.[0] ?? null;

  const refreshBalance = useCallback(async () => {
    try {
      const me = await getMyPoints();
      setBalance(me.total);
    } catch {
      setBalance(null); // header shows "—"; the server still enforces the balance
    }
  }, []);

  useEffect(() => {
    if (canSendTokens) void refreshBalance();
  }, [canSendTokens, refreshBalance]);

  const openSend = (userId: string) => {
    setSendErr(null);
    if (sendFor === userId) {
      setSendFor(null);
      return;
    }
    setAwardFor(null);
    setSendFor(userId);
    void refreshBalance();
  };

  /** Idempotency-Key of the last unconfirmed host send, keyed by what was sent. */
  const sendAttemptRef = useRef<{ sig: string; key: string } | null>(null);
  const clampSend = (n: number) => Math.max(SEND_MIN, Math.min(SEND_MAX, Math.round(n) || SEND_MIN));
  const noteNeeded = sendPurpose === 'other';
  const noteMissing = noteNeeded && !sendNote.trim();

  const submitSend = async (m: HuddleMember) => {
    if (sending) return;
    const amt = clampSend(sendAmount);
    if (noteMissing) {
      setSendErr('Add a short note for "Other".');
      return;
    }
    if (balance !== null && amt > balance) {
      setSendErr('Not enough Rendly Tokens.');
      return;
    }
    setSending(true);
    setSendErr(null);
    // Same recipient, amount, purpose and note as the failed attempt: retry with its key so it cannot send twice.
    const sig = `${m.user_id}|${amt}|${sendPurpose}|${sendNote.trim()}`;
    if (!sendAttemptRef.current || sendAttemptRef.current.sig !== sig) {
      sendAttemptRef.current = { sig, key: newIdempotencyKey() };
    }
    try {
      const res = await sendHuddleTokens(huddle.id, {
        user_id: m.user_id,
        amount: amt,
        purpose: sendPurpose,
        note: noteNeeded ? sendNote.trim() : sendNote.trim() || null,
        idempotency_key: sendAttemptRef.current.key,
      });
      sendAttemptRef.current = null;
      if (typeof res.balance === 'number') setBalance(res.balance);
      else void refreshBalance();
      emitPointsChanged();
      notifyPointsPeers([m.user_id]);
      websocket.emit('huddle:tokens', { huddle_id: huddle.id, room, to: m.user_id, amount: amt, kind: 'transfer' });
      pushToast({ icon: 'coin', title: `Sent ${amt} Rendly Tokens to ${name(m)}` });
      setSendNote('');
      closeMenu();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Could not send Rendly Tokens');
    } finally {
      setSending(false);
    }
  };

  const act = async (id: string, fn: () => Promise<void>): Promise<boolean> => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** Runs a menu action, then slides the menu closed once it succeeds. */
  const actAndClose = (id: string, fn: () => Promise<void>) => {
    void act(id, fn).then((ok) => {
      if (ok) closeMenu();
    });
  };

  const menuItems = (m: HuddleMember, manage: boolean, disabled: boolean): PersonMenuItem[] => {
    const items: PersonMenuItem[] = [];
    if (manage) {
      items.push({
        key: 'mute',
        label: m.is_muted ? 'Unmute' : 'Mute',
        icon: <Icon name={m.is_muted ? 'mic' : 'mic-off'} size={15} />,
        locked: disabled,
        onSelect: () =>
          actAndClose(m.user_id, async () => {
            await updateHuddleMember(huddle.id, m.user_id, { is_muted: !m.is_muted });
            websocket.emit('huddle:mute', { huddle_id: huddle.id, target: m.user_id, muted: !m.is_muted });
          }),
      });
    }
    if (isHost) {
      const admin = m.role === 'co_host';
      items.push({
        key: 'admin',
        label: admin ? 'Remove admin' : 'Make admin',
        icon: <Icon name="shield" size={15} />,
        active: admin,
        locked: disabled,
        onSelect: () =>
          actAndClose(m.user_id, async () => {
            const nextRole = admin ? 'participant' : 'co_host';
            await updateHuddleMember(huddle.id, m.user_id, { role: nextRole });
            // Tell their client at once, so admin powers (like screen sharing) work without a reload.
            websocket.emit('huddle:role', { huddle_id: huddle.id, target: m.user_id, role: nextRole });
          }),
      });
    }
    if (manage && m.role !== 'co_host') {
      items.push({
        key: 'share',
        label: m.can_share_screen ? 'Revoke screen share' : 'Allow screen share',
        icon: <Icon name="screen" size={15} />,
        active: !!m.can_share_screen,
        locked: disabled,
        onSelect: () =>
          actAndClose(m.user_id, async () => {
            const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('huddle:permit', {
              huddle_id: huddle.id,
              target: m.user_id,
              can_share_screen: !m.can_share_screen,
            });
            if (!res?.ok) throw new Error(res?.message ?? 'Could not change screen sharing');
          }),
      });
    }
    items.push({
      key: 'reward',
      label: 'Reward tokens',
      icon: <Icon name="trophy" size={15} />,
      active: awardFor === m.user_id,
      locked: !flags.rewards_enabled,
      lockedHint: 'Turn on free rewards in huddle settings',
      onSelect: () => {
        setSendFor(null);
        setAwardFor(awardFor === m.user_id ? null : m.user_id);
      },
    });
    if (isHost) {
      items.push({
        key: 'send',
        label: 'Send from my balance',
        icon: <TokenCoin size={15} />,
        active: sendFor === m.user_id,
        locked: !canSendTokens,
        lockedHint: 'Turn on paying participants in huddle settings',
        onSelect: () => openSend(m.user_id),
      });
    }
    items.push({
      key: 'remove',
      label: 'Remove from huddle',
      icon: <Icon name="close" size={15} />,
      danger: true,
      locked: disabled,
      onSelect: () => actAndClose(m.user_id, () => removeHuddleMember(huddle.id, m.user_id)),
    });
    return items;
  };

  const name = (m: HuddleMember) => m.display_name || (m.username ? `@${m.username}` : 'Guest');

  return (
    <div className="hr-people rd-scroll">
      {err ? <p className="hr-err">{err}</p> : null}
      {isManager && waiting.length > 0 ? (
        <>
          <div className="hr-waiting-head">
            <h4 className="hr-subhead">Waiting ({waiting.length})</h4>
            {waiting.length > 1 ? (
              <button
                type="button"
                className="rd-btn rd-btn--primary rd-btn--sm"
                disabled={busy !== null}
                onClick={() =>
                  act('__all__', async () => {
                    const { failed } = await admitAllHuddleMembers(huddle.id, waiting.map((m) => m.user_id));
                    if (failed > 0) {
                      await onChanged(); // show who did get in before reporting the rest
                      throw new Error(`${failed} ${failed === 1 ? 'person' : 'people'} could not be admitted. Try again.`);
                    }
                  })
                }
              >
                {busy === '__all__' ? 'Admitting…' : `Admit all (${waiting.length})`}
              </button>
            ) : null}
          </div>
          {waiting.map((m) => (
            <div key={m.user_id} className="hr-person">
              <Avatar url={m.avatar_url} name={m.username} size="sm" />
              <span className="hr-person-name">{name(m)}</span>
              <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" disabled={busy === m.user_id} onClick={() => act(m.user_id, () => admitHuddleMember(huddle.id, m.user_id))}>
                Admit
              </button>
            </div>
          ))}
        </>
      ) : null}
      <label className="hr-people-search">
        <Icon name="search" size={15} />
        <input
          className="hr-people-search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isHost ? 'Search people to assign admins' : 'Search people'}
          aria-label="Search people"
        />
      </label>
      <h4 className="hr-subhead">
        {searching ? `Matches (${matchIds.size})` : `In the huddle (${inRoom.length})`}
      </h4>
      {searching && matchIds.size === 0 ? <p className="rd-small rd-muted">Nobody matches “{query.trim()}”.</p> : null}
      {shown.map((m) => {
        const self = m.user_id === myId;
        const disabled = busy === m.user_id;
        const leads = leadOf(m.user_id);
        // Mute and sharing: the host anywhere, a room leader only for people in the room they lead.
        const manage = isHost || (canManageHere && peersInRoom.includes(m.user_id));
        const hit = matchIds.has(m.user_id);
        return (
          <motion.div
            key={m.user_id}
            layout={reduceMotion ? false : 'position'}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={`hr-person-wrap ${hit ? 'hr-person-wrap--hit' : ''}`}
          >
            <div className="hr-person">
              <Avatar url={m.avatar_url} name={m.username} size="sm" />
              <span className="hr-person-name">
                {name(m)} {self ? <span className="rd-muted">(you)</span> : null}
                <span className="rd-small rd-muted">
                  {roleLabel(m.role)}
                  {leads ? ` · Leads ${roomLabel(leads)}` : ''}
                  {peersInRoom.includes(m.user_id) || self ? '' : ' · other room'}
                </span>
              </span>
              {isManager && !self && m.role !== 'host' ? (
                <PersonMenuTrigger open={menuFor === m.user_id} onToggle={() => toggleMenu(m.user_id)} label={name(m)} disabled={disabled} />
              ) : null}
            </div>
            <PersonMenu open={menuFor === m.user_id} items={menuItems(m, manage, disabled)}>
            {awardFor === m.user_id ? (
              <form
                className="hr-award"
                onSubmit={(e) => {
                  e.preventDefault();
                  actAndClose(m.user_id, async () => {
                    await awardPoints(huddle.id, m.user_id, amount, note.trim() || undefined);
                    websocket.emit('huddle:tokens', { huddle_id: huddle.id, room, to: m.user_id, amount, kind: 'reward' });
                    setNote('');
                  });
                }}
              >
                <input className="rd-input" type="number" min={1} max={1000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} aria-label="Rendly Tokens" />
                <input className="rd-input" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="For… (quiz winner)" aria-label="Reason" />
                <button type="submit" className="rd-btn rd-btn--primary rd-btn--sm" disabled={disabled}>
                  Give
                </button>
              </form>
            ) : null}
            {sendFor === m.user_id && canSendTokens ? (
              <form
                className="hr-send"
                aria-label={`Send Rendly Tokens to ${name(m)}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSend(m);
                }}
              >
                <div className="hr-send-head">
                  <span className="hr-send-title">
                    <TokenCoin size={14} /> Send to {name(m)}
                  </span>
                  <span className="hr-send-balance rd-small rd-muted">
                    Balance {balance === null ? '—' : <TokenAmount amount={balance} size={12} />}
                  </span>
                </div>
                <div className="hr-send-amount">
                  <input
                    className="rd-input rd-mono"
                    type="number"
                    inputMode="numeric"
                    min={SEND_MIN}
                    max={SEND_MAX}
                    value={sendAmount}
                    onChange={(e) => setSendAmount(clampSend(Number(e.target.value)))}
                    aria-label="Amount of Rendly Tokens"
                  />
                  <div className="hr-send-chips" role="group" aria-label="Quick amounts">
                    {SEND_QUICK_AMOUNTS.map((q) => (
                      <button key={q} type="button" className={`rd-chip ${sendAmount === q ? 'rd-chip--on' : ''}`} aria-pressed={sendAmount === q} onClick={() => setSendAmount(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
                <select className="rd-select" value={sendPurpose} onChange={(e) => setSendPurpose(e.target.value as HuddleSendPurpose)} aria-label="Purpose">
                  {HUDDLE_SEND_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {HUDDLE_SEND_PURPOSE_LABELS[p]}
                    </option>
                  ))}
                </select>
                {noteNeeded ? (
                  <input
                    className="rd-input"
                    value={sendNote}
                    maxLength={SEND_NOTE_MAX}
                    required
                    onChange={(e) => setSendNote(e.target.value)}
                    placeholder="What is this for? (required)"
                    aria-label="Note (required for Other)"
                  />
                ) : null}
                {sendErr ? (
                  <p className="hr-err hr-send-err" role="alert">
                    {sendErr}
                  </p>
                ) : null}
                <div className="hr-send-actions">
                  <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => setSendFor(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="rd-btn rd-btn--primary rd-btn--sm" disabled={sending || noteMissing}>
                    {sending ? <span className="rd-spinner" /> : null}
                    Send {clampSend(sendAmount)}
                  </button>
                </div>
              </form>
            ) : null}
            </PersonMenu>
          </motion.div>
        );
      })}
    </div>
  );
}

function HostSettings({ huddle, isHost, flags, onFlagsChange }: { huddle: HuddleDetail; isHost: boolean; flags: RewardFlags; onFlagsChange: (next: RewardFlags) => void }) {
  const [state, setState] = useState({
    waiting_room: huddle.waiting_room ?? false,
    allow_self_exit: huddle.allow_self_exit !== false,
    rewards_enabled: flags.rewards_enabled,
    rewards_receive_enabled: flags.rewards_receive_enabled,
    tips_enabled: flags.tips_enabled,
  });
  const [err, setErr] = useState<string | null>(null);
  const isRewardKey = (key: keyof typeof state): key is keyof RewardFlags => key === 'rewards_enabled' || key === 'rewards_receive_enabled' || key === 'tips_enabled';
  const toggle = async (key: keyof typeof state) => {
    if (!isHost) return;
    const next = !state[key];
    setState((s) => ({ ...s, [key]: next }));
    setErr(null);
    try {
      await updateHuddleSettings(huddle.id, { [key]: next });
      if (isRewardKey(key)) onFlagsChange({ ...flags, [key]: next });
    } catch (e) {
      setState((s) => ({ ...s, [key]: !next }));
      setErr(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const rows: { key: keyof typeof state; title: string; hint: string }[] = [
    { key: 'waiting_room', title: 'Waiting room', hint: 'You admit each person before they enter.' },
    { key: 'allow_self_exit', title: 'People can leave freely', hint: 'Off: you control entry and exit, including breakout rooms.' },
    { key: 'rewards_enabled', title: 'Give free rewards', hint: 'Free Rendly Tokens for quizzes and best answers (not taken from you).' },
    { key: 'rewards_receive_enabled', title: 'Pay participants', hint: 'Send Rendly Tokens from your own balance to people in the room.' },
    { key: 'tips_enabled', title: 'Receive tokens', hint: 'Participants can send you Rendly Tokens during the huddle.' },
  ];
  return (
    <div className="hr-settings rd-scroll">
      {!isHost ? <p className="rd-small rd-muted">Only the host can change these.</p> : null}
      {rows.map((r) => (
        <label key={r.key} className="hr-switch-row">
          <span>
            <strong>{r.title}</strong>
            <span className="rd-small rd-muted">{r.hint}</span>
          </span>
          <input type="checkbox" className="hr-switch" checked={state[r.key]} disabled={!isHost} onChange={() => void toggle(r.key)} />
        </label>
      ))}
      {err ? <p className="hr-err">{err}</p> : null}
    </div>
  );
}
