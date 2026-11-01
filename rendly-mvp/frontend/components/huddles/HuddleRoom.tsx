'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/context/CurrentUserContext';
import websocket from '@/services/websocket';
import {
  admitHuddleMember,
  listHuddleMembers,
  removeHuddleMember,
  updateHuddleMember,
  updateHuddleSettings,
  type HuddleDetail,
  type HuddleMember,
} from '@/services/huddlesApi';
import { awardPoints } from '@/services/pointsApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import './huddle-room.css';

const MAIN_ROOM = 'main';
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
const MEMBERS_POLL_MS = 5000;
const ROOM_NAME = /^[a-z0-9][a-z0-9-]{0,19}$/;

type Role = 'host' | 'co_host' | 'participant';
type Peer = { cam: MediaStream | null; screen: MediaStream | null; screenId: string | null };
type ChatLine = { id: string; from: string; text: string; at: string };
type Panel = 'people' | 'chat' | 'rooms' | 'host' | null;
type JoinAck = { ok: boolean; message?: string; peers?: string[]; can_speak?: boolean; can_share_screen?: boolean; screens?: Record<string, string> };

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
}: {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  muted?: boolean;
  mirror?: boolean;
  badge?: string;
  screen?: boolean;
  camOff?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const speaking = useSpeaking(stream, !screen);
  const [hasVideo, setHasVideo] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => undefined);
    const check = () => setHasVideo(!!stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled && !t.muted));
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [stream]);
  const showVideo = hasVideo && !camOff;
  return (
    <div className={`hr-tile ${speaking ? 'hr-tile--speaking' : ''} ${screen ? 'hr-tile--screen' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'hr-mirror' : ''} style={{ opacity: showVideo ? 1 : 0, objectFit: screen ? 'contain' : 'cover' }} />
      {!showVideo ? (
        <div className="hr-tile-avatar">
          <Avatar url={avatarUrl} name={name} size="lg" />
        </div>
      ) : null}
      <span className="hr-tile-name">
        {badge ? <em>{badge}</em> : null}
        {name}
      </span>
    </div>
  );
}

export default function HuddleRoom({
  huddle,
  onLeave,
  onEnd,
  canLeave,
}: {
  huddle: HuddleDetail;
  onLeave: () => void;
  onEnd?: () => void;
  canLeave: boolean;
}) {
  const huddleId = huddle.id;
  const role = (huddle.your_role ?? 'participant') as Role;
  const isManager = role === 'host' || role === 'co_host';
  const { user } = useCurrentUser();
  const myId = user?.id ?? null;

  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState(MAIN_ROOM);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [canSpeak, setCanSpeak] = useState(huddle.your_permissions?.can_speak ?? true);
  const [canShare, setCanShare] = useState(isManager || (huddle.your_permissions?.can_share_screen ?? false));
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [members, setMembers] = useState<HuddleMember[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pcs = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const screenIds = useRef<Record<string, string | null>>({});
  const streamsByPeer = useRef<Record<string, Map<string, MediaStream>>>({});
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const screenSenders = useRef<Record<string, RTCRtpSender[]>>({});
  const roomRef = useRef(MAIN_ROOM);
  const panelRef = useRef<Panel>(null);
  panelRef.current = panel;

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
    setPeers((cur) => ({ ...cur, [id]: { cam: cam ? new MediaStream((cam as MediaStream).getTracks()) : null, screen: scr, screenId } }));
  }, []);

  const dropPeer = useCallback((id: string) => {
    pcs.current[id]?.close();
    delete pcs.current[id];
    delete pendingIce.current[id];
    delete streamsByPeer.current[id];
    delete screenSenders.current[id];
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
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcs.current[id] = pc;
      const l = localRef.current;
      if (l) l.getTracks().forEach((t) => pc.addTrack(t, l));
      else {
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
        if (pc.signalingState === 'stable' && (pc.localDescription || (myId && myId < id))) void renegotiate(id);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') dropPeer(id);
      };
      return pc;
    },
    [signal, publishPeer, renegotiate, dropPeer, myId]
  );

  const handleSignal = useCallback(
    async (from: string, data: { type?: string; sdp?: string; candidate?: RTCIceCandidateInit }) => {
      const pc = connectionFor(from);
      try {
        if (data.type === 'offer' && data.sdp) {
          // Glare: if we were also offering, the higher id backs off.
          if (pc.signalingState === 'have-local-offer') {
            if (myId && myId < from) return;
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
    [connectionFor, signal, myId]
  );

  // ---------- rooms ----------
  const joinRoom = useCallback(
    async (name: string): Promise<boolean> => {
      if (!websocket.isConnected()) return false;
      try {
        const res = await websocket.emitWithAck<JoinAck>('huddle:join', { huddle_id: huddleId, room: name });
        if (!res?.ok) {
          setNotice(res?.message ?? 'Could not join the room');
          return false;
        }
        roomRef.current = name;
        setRoom(name);
        if (typeof res.can_speak === 'boolean') setCanSpeak(res.can_speak);
        if (typeof res.can_share_screen === 'boolean') setCanShare(res.can_share_screen);
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
  useEffect(() => {
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
        setPeers((cur) => ({ ...cur, [user_id]: cur[user_id] ?? { cam: null, screen: null, screenId: null } }));
        connectionFor(user_id);
      }),
      websocket.on<{ user_id: string }>('huddle:peer-left', ({ user_id }) => dropPeer(user_id)),
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
      websocket.on<{ muted: boolean }>('huddle:muted', ({ muted }) => {
        setMutedByHost(muted);
        if (muted) setNotice('The host muted you.');
      }),
      websocket.on<{ huddle_id: string; room: string }>('huddle:assigned', ({ huddle_id, room: next }) => {
        if (huddle_id !== huddleId || next === roomRef.current) return;
        setNotice(next === MAIN_ROOM ? 'You are back in the main room.' : `The host moved you to room “${next}”.`);
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
    // Set up once per huddle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huddleId]);

  // Mic/camera switches apply to the live tracks.
  useEffect(() => {
    const s = localRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = micOn && canSpeak && !mutedByHost));
    s.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }, [micOn, camOn, canSpeak, mutedByHost, local]);

  // Roster (names, roles, permissions). Hosts also see the waiting list.
  const loadMembers = useCallback(async () => {
    try {
      const list = await listHuddleMembers(huddleId);
      setMembers(list);
      const me = list.find((m) => m.user_id === myId);
      if (me && !isManager) {
        setCanShare(me.can_share_screen);
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

  const tiles = (
    <>
      <Tile stream={local} name={`${meName} (you)`} avatarUrl={user?.avatar_url} muted mirror camOff={!camOn} badge={role !== 'participant' ? (role === 'host' ? 'Host' : 'Co-host') : undefined} />
      {peerIds.map((id) => {
        const m = members.find((x) => x.user_id === id);
        return <Tile key={id} stream={peers[id].cam} name={nameOf(id)} avatarUrl={avatarOf(id)} badge={m?.role === 'host' ? 'Host' : m?.role === 'co_host' ? 'Co-host' : undefined} />;
      })}
    </>
  );

  return (
    <div className={`hr ${panel ? 'hr--panel' : ''}`}>
      <div className="hr-stage">
        <div className="hr-topline">
          <span className="rd-badge rd-badge--live">LIVE</span>
          <strong className="hr-title">{huddle.title}</strong>
          {room !== MAIN_ROOM ? <span className="rd-chip rd-chip--on">Room: {room}</span> : null}
          {status === 'connecting' ? <span className="rd-small rd-muted"><span className="rd-spinner" /> connecting…</span> : null}
          {room !== MAIN_ROOM && (isManager || huddle.allow_self_exit !== false) ? (
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => void moveTo(MAIN_ROOM)}>
              <Icon name="door" size={14} /> Back to main room
            </button>
          ) : null}
        </div>
        {notice ? <div className="hr-notice" role="status">{notice}</div> : null}
        {error ? <div className="hr-notice hr-notice--error" role="alert">{error}</div> : null}

        {shareStream ? (
          <div className="hr-share">
            <Tile stream={shareStream} name={sharer === myId ? 'Your screen' : `${nameOf(sharer ?? '')}'s screen`} screen muted />
            <div className="hr-filmstrip rd-scroll">{tiles}</div>
          </div>
        ) : (
          <div className={`hr-grid ${gridClass}`}>{tiles}</div>
        )}

        <div className="hr-controls">
          <button type="button" className={`call-ctl ${micOn && canSpeak && !mutedByHost ? '' : 'call-ctl--off'}`} disabled={!local || !canSpeak} onClick={() => { setMicOn((v) => !v); if (mutedByHost) setMutedByHost(false); }} title={canSpeak ? 'Microphone' : 'The host has not let you speak yet'} aria-label="Microphone">
            <Icon name={micOn && canSpeak && !mutedByHost ? 'mic' : 'mic-off'} />
          </button>
          <button type="button" className={`call-ctl ${camOn ? '' : 'call-ctl--off'}`} disabled={!local} onClick={() => setCamOn((v) => !v)} aria-label="Camera" title="Camera">
            <Icon name={camOn ? 'video' : 'video-off'} />
          </button>
          <button type="button" className={`call-ctl ${screen ? 'call-ctl--on' : ''}`} disabled={!canShare} onClick={() => void startShare()} aria-label="Share screen" title={canShare ? 'Share screen' : 'Ask the host for permission to share'}>
            <Icon name="screen" />
          </button>
          <span className="hr-controls-sep" />
          <button type="button" className={`call-ctl ${panel === 'people' ? 'call-ctl--on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label="People" title="People">
            <Icon name="people" />
          </button>
          <button type="button" className={`call-ctl ${panel === 'chat' ? 'call-ctl--on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} aria-label="Chat" title="Chat">
            <Icon name="chat" />
            {unreadChat > 0 ? <span className="rd-count">{unreadChat}</span> : null}
          </button>
          {isManager ? (
            <>
              <button type="button" className={`call-ctl ${panel === 'rooms' ? 'call-ctl--on' : ''}`} onClick={() => setPanel(panel === 'rooms' ? null : 'rooms')} aria-label="Breakout rooms" title="Breakout rooms">
                <Icon name="grid" />
              </button>
              <button type="button" className={`call-ctl ${panel === 'host' ? 'call-ctl--on' : ''}`} onClick={() => setPanel(panel === 'host' ? null : 'host')} aria-label="Host settings" title="Host settings">
                <Icon name="settings" />
              </button>
            </>
          ) : null}
          <span className="hr-controls-sep" />
          <button
            type="button"
            className="call-ctl call-ctl--end"
            onClick={onLeave}
            disabled={!canLeave}
            aria-label="Leave huddle"
            title={canLeave ? 'Leave' : 'The host controls when people leave'}
          >
            <Icon name="phone-off" />
          </button>
          {role === 'host' && onEnd ? (
            <button type="button" className="rd-btn rd-btn--danger rd-btn--sm" onClick={onEnd}>
              End for all
            </button>
          ) : null}
        </div>
      </div>

      {panel ? (
        <aside className="hr-panel rd-card" aria-label="Side panel">
          <header className="hr-panel-head">
            <strong>{panel === 'people' ? 'People' : panel === 'chat' ? `Chat · ${room}` : panel === 'rooms' ? 'Breakout rooms' : 'Host settings'}</strong>
            <button type="button" className="rd-icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
              <Icon name="close" size={16} />
            </button>
          </header>
          {panel === 'people' ? <PeoplePanel huddle={huddle} members={members} myId={myId} isManager={isManager} isHost={role === 'host'} onChanged={loadMembers} peersInRoom={peerIds} /> : null}
          {panel === 'chat' ? (
            <div className="hr-chat">
              <div className="hr-chat-list rd-scroll">
                {chat.length === 0 ? <p className="rd-small rd-muted">Messages go to everyone in this room.</p> : null}
                {chat.map((c) => (
                  <div key={c.id} className={`hr-chat-line ${c.from === myId ? 'hr-chat-line--me' : ''}`}>
                    <span className="rd-small rd-muted">{c.from === myId ? 'You' : nameOf(c.from)}</span>
                    <p>{c.text}</p>
                  </div>
                ))}
              </div>
              <form className="hr-chat-input" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
                <input className="rd-input" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="Message the room" aria-label="Message" />
                <button type="submit" className="rd-icon-btn" disabled={!draft.trim()} aria-label="Send">
                  <Icon name="send" size={16} />
                </button>
              </form>
            </div>
          ) : null}
          {panel === 'rooms' && isManager ? <RoomsPanel huddleId={huddleId} members={members} myId={myId} currentRoom={room} onPeek={(r) => void moveTo(r)} /> : null}
          {panel === 'host' && isManager ? <HostSettings huddle={huddle} isHost={role === 'host'} /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function PeoplePanel({
  huddle,
  members,
  myId,
  isManager,
  isHost,
  onChanged,
  peersInRoom,
}: {
  huddle: HuddleDetail;
  members: HuddleMember[];
  myId: string | null;
  isManager: boolean;
  isHost: boolean;
  onChanged: () => Promise<void>;
  peersInRoom: string[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [awardFor, setAwardFor] = useState<string | null>(null);
  const [amount, setAmount] = useState(50);
  const [note, setNote] = useState('');
  const waiting = members.filter((m) => !m.admitted);
  const inRoom = members.filter((m) => m.admitted);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const name = (m: HuddleMember) => m.display_name || (m.username ? `@${m.username}` : 'Guest');

  return (
    <div className="hr-people rd-scroll">
      {err ? <p className="hr-err">{err}</p> : null}
      {isManager && waiting.length > 0 ? (
        <>
          <h4 className="hr-subhead">Waiting ({waiting.length})</h4>
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
      <h4 className="hr-subhead">In the huddle ({inRoom.length})</h4>
      {inRoom.map((m) => {
        const self = m.user_id === myId;
        const disabled = busy === m.user_id;
        return (
          <div key={m.user_id} className="hr-person-wrap">
            <div className="hr-person">
              <Avatar url={m.avatar_url} name={m.username} size="sm" />
              <span className="hr-person-name">
                {name(m)} {self ? <span className="rd-muted">(you)</span> : null}
                <span className="rd-small rd-muted">
                  {m.role === 'host' ? 'Host' : m.role === 'co_host' ? 'Co-host' : 'Participant'}
                  {peersInRoom.includes(m.user_id) || self ? '' : ' · other room'}
                </span>
              </span>
              {isManager && !self && m.role !== 'host' ? (
                <div className="hr-person-actions">
                  <button type="button" className={`rd-icon-btn ${m.is_muted ? 'rd-icon-btn--on' : ''}`} title={m.is_muted ? 'Unmute' : 'Mute'} disabled={disabled}
                    onClick={() => act(m.user_id, async () => {
                      await updateHuddleMember(huddle.id, m.user_id, { is_muted: !m.is_muted });
                      websocket.emit('huddle:mute', { huddle_id: huddle.id, target: m.user_id, muted: !m.is_muted });
                    })}>
                    <Icon name={m.is_muted ? 'mic-off' : 'mic'} size={15} />
                  </button>
                  <button type="button" className={`rd-icon-btn ${m.can_share_screen ? 'rd-icon-btn--on' : ''}`} title={m.can_share_screen ? 'Revoke screen sharing' : 'Allow screen sharing'} disabled={disabled}
                    onClick={() => act(m.user_id, () => updateHuddleMember(huddle.id, m.user_id, { can_share_screen: !m.can_share_screen }))}>
                    <Icon name="screen" size={15} />
                  </button>
                  {huddle.rewards_enabled !== false ? (
                    <button type="button" className="rd-icon-btn" title="Give points" onClick={() => setAwardFor(awardFor === m.user_id ? null : m.user_id)}>
                      <Icon name="trophy" size={15} />
                    </button>
                  ) : null}
                  {isHost ? (
                    <button type="button" className="rd-icon-btn" title={m.role === 'co_host' ? 'Remove co-host' : 'Make co-host'} disabled={disabled}
                      onClick={() => act(m.user_id, () => updateHuddleMember(huddle.id, m.user_id, { role: m.role === 'co_host' ? 'participant' : 'co_host' }))}>
                      <Icon name="star" size={15} />
                    </button>
                  ) : null}
                  <button type="button" className="rd-icon-btn rd-icon-btn--danger" title="Remove from huddle" disabled={disabled} onClick={() => act(m.user_id, () => removeHuddleMember(huddle.id, m.user_id))}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ) : null}
            </div>
            {awardFor === m.user_id ? (
              <form
                className="hr-award"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(m.user_id, async () => {
                    await awardPoints(huddle.id, m.user_id, amount, note.trim() || undefined);
                    setAwardFor(null);
                    setNote('');
                  });
                }}
              >
                <input className="rd-input" type="number" min={1} max={1000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} aria-label="Points" />
                <input className="rd-input" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="For… (quiz winner)" aria-label="Reason" />
                <button type="submit" className="rd-btn rd-btn--primary rd-btn--sm" disabled={disabled}>
                  Give
                </button>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RoomsPanel({
  huddleId,
  members,
  myId,
  currentRoom,
  onPeek,
}: {
  huddleId: string;
  members: HuddleMember[];
  myId: string | null;
  currentRoom: string;
  onPeek: (room: string) => void;
}) {
  const [rooms, setRooms] = useState<{ room: string; user_ids: string[] }[]>([]);
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [count, setCount] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const people = useMemo(() => members.filter((m) => m.admitted && m.user_id !== myId && m.role === 'participant'), [members, myId]);
  const roomNames = useMemo(() => Array.from({ length: count }, (_, i) => `room-${i + 1}`), [count]);

  const refresh = useCallback(async () => {
    try {
      const res = await websocket.emitWithAck<{ ok: boolean; rooms?: { room: string; user_ids: string[] }[]; message?: string }>('huddle:rooms', { huddle_id: huddleId });
      if (res?.ok) setRooms(res.rooms ?? []);
      else setErr(res?.message ?? 'Could not load rooms');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load rooms');
    }
  }, [huddleId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const autoSplit = () => {
    const next: Record<string, string> = {};
    people.forEach((p, i) => (next[p.user_id] = roomNames[i % roomNames.length]));
    setPlan(next);
  };

  const apply = (assignments: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(assignments).filter(([, r]) => r === MAIN_ROOM || ROOM_NAME.test(r)));
    if (!websocket.isConnected()) {
      setErr('Not connected — nobody was moved. Try again once you are back online.');
      return;
    }
    setErr(null);
    websocket.emit('huddle:breakout', { huddle_id: huddleId, assignments: clean });
    setSent(Object.keys(clean).length ? 'People are being moved.' : null);
    setTimeout(() => void refresh(), 800);
  };

  const label = (id: string) => {
    const m = members.find((x) => x.user_id === id);
    return m?.display_name || (m?.username ? `@${m.username}` : 'Guest');
  };

  return (
    <div className="hr-rooms rd-scroll">
      {err ? <p className="hr-err">{err}</p> : null}
      <h4 className="hr-subhead">Live rooms</h4>
      {rooms.length === 0 ? <p className="rd-small rd-muted">Only the main room is open.</p> : null}
      {rooms
        .sort((a, b) => (a.room === MAIN_ROOM ? -1 : b.room === MAIN_ROOM ? 1 : a.room.localeCompare(b.room)))
        .map((r) => (
          <div key={r.room} className={`hr-room ${r.room === currentRoom ? 'hr-room--here' : ''}`}>
            <div className="hr-room-head">
              <strong>{r.room === MAIN_ROOM ? 'Main room' : r.room}</strong>
              <span className="rd-small rd-muted">{r.user_ids.length} in room</span>
              {r.room !== currentRoom ? (
                <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => onPeek(r.room)}>
                  <Icon name="eye" size={14} /> {r.room === MAIN_ROOM ? 'Return' : 'Peek'}
                </button>
              ) : (
                <span className="rd-chip">You are here</span>
              )}
            </div>
            <p className="rd-small rd-muted">{r.user_ids.map(label).join(', ') || 'Empty'}</p>
          </div>
        ))}

      <h4 className="hr-subhead">Split into rooms</h4>
      {people.length === 0 ? (
        <p className="rd-small rd-muted">Participants appear here once they join.</p>
      ) : (
        <>
          <div className="hr-rooms-row">
            <label className="rd-small">
              Rooms
              <select className="rd-select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={autoSplit}>
              Auto-assign
            </button>
          </div>
          {people.map((p) => (
            <div key={p.user_id} className="hr-person">
              <Avatar url={p.avatar_url} name={p.username} size="sm" />
              <span className="hr-person-name">{label(p.user_id)}</span>
              <select className="rd-select" value={plan[p.user_id] ?? MAIN_ROOM} onChange={(e) => setPlan((cur) => ({ ...cur, [p.user_id]: e.target.value }))} aria-label={`Room for ${label(p.user_id)}`}>
                <option value={MAIN_ROOM}>Main</option>
                {roomNames.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="hr-rooms-row">
            <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => apply(plan)} disabled={Object.keys(plan).length === 0}>
              Open rooms
            </button>
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => apply(Object.fromEntries(people.map((p) => [p.user_id, MAIN_ROOM])))}>
              Bring everyone back
            </button>
          </div>
          {sent ? <p className="rd-small rd-muted">{sent}</p> : null}
        </>
      )}
    </div>
  );
}

function HostSettings({ huddle, isHost }: { huddle: HuddleDetail; isHost: boolean }) {
  const [state, setState] = useState({
    waiting_room: huddle.waiting_room ?? false,
    allow_self_exit: huddle.allow_self_exit !== false,
    rewards_enabled: huddle.rewards_enabled !== false,
  });
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (key: keyof typeof state) => {
    if (!isHost) return;
    const next = !state[key];
    setState((s) => ({ ...s, [key]: next }));
    setErr(null);
    try {
      await updateHuddleSettings(huddle.id, { [key]: next });
    } catch (e) {
      setState((s) => ({ ...s, [key]: !next }));
      setErr(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const rows: { key: keyof typeof state; title: string; hint: string }[] = [
    { key: 'waiting_room', title: 'Waiting room', hint: 'You admit each person before they enter.' },
    { key: 'allow_self_exit', title: 'People can leave freely', hint: 'Off: you control entry and exit, including breakout rooms.' },
    { key: 'rewards_enabled', title: 'Rewards', hint: 'Give points for quizzes and competitions.' },
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
