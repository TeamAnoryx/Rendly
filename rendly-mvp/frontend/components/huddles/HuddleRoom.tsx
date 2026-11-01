'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getCcsWsUrl } from '@/lib/resolvedApiUrl';
import { getStoredAuthToken } from '@/lib/auth-storage';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { listHuddleMembers, type HuddleMember } from '@/services/huddlesApi';

const MAIN_ROOM = 'main';
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

type Role = 'host' | 'co_host' | 'participant';
type ChatLine = { id: number; from: string; text: string; room: string; at: string };

type HuddleRoomProps = {
  huddleId: string;
  role: Role;
  canSpeak: boolean;
};

type PeerState = { stream: MediaStream | null; label: string };

/**
 * Group video for a huddle: a peer mesh (every participant connects to every other one),
 * signalled over the chat socket. Built for small rooms; see the README for limits.
 */
export default function HuddleRoom({ huddleId, role, canSpeak }: HuddleRoomProps) {
  const { user } = useCurrentUser();
  const myId = user?.id ?? null;
  const canManage = role === 'host' || role === 'co_host';

  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState(MAIN_ROOM);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [mutedByHost, setMutedByHost] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [members, setMembers] = useState<HuddleMember[]>([]);
  const [breakoutName, setBreakoutName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  // A seminar audience cannot speak until the host lets them. The server's seat rule is the source of truth.
  const [speakingAllowed, setSpeakingAllowed] = useState(canSpeak);

  const socketRef = useRef<Socket | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localRef = useRef<MediaStream | null>(null);
  const roomRef = useRef(MAIN_ROOM);
  const chatIdRef = useRef(0);

  const setPeer = useCallback((id: string, patch: Partial<PeerState>) => {
    setPeers((cur) => ({ ...cur, [id]: { stream: cur[id]?.stream ?? null, label: cur[id]?.label ?? 'Participant', ...patch } }));
  }, []);

  const dropPeer = useCallback((id: string) => {
    pcsRef.current[id]?.close();
    delete pcsRef.current[id];
    delete pendingIceRef.current[id];
    setPeers((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const emitSignal = useCallback((to: string, data: unknown) => {
    socketRef.current?.emit('huddle:signal', { huddle_id: huddleId, room: roomRef.current, to, data });
  }, [huddleId]);

  /** Peer connection for one other participant, created on first use. */
  const connectionFor = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = pcsRef.current[peerId];
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcsRef.current[peerId] = pc;
      localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current as MediaStream));
      pc.onicecandidate = (event) => {
        if (event.candidate) emitSignal(peerId, { type: 'ice', candidate: event.candidate.toJSON() });
      };
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        setPeer(peerId, { stream: stream ?? null });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(peerId);
      };
      return pc;
    },
    [emitSignal, dropPeer, setPeer]
  );

  /** The lower user id offers, so each pair negotiates exactly once. */
  const offerTo = useCallback(
    async (peerId: string) => {
      if (!myId || myId >= peerId) return;
      const pc = connectionFor(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emitSignal(peerId, { type: 'offer', sdp: pc.localDescription?.sdp });
    },
    [myId, connectionFor, emitSignal]
  );

  const handleSignal = useCallback(
    async (from: string, data: { type?: string; sdp?: string; candidate?: RTCIceCandidateInit }) => {
      const pc = connectionFor(from);
      try {
        if (data.type === 'offer' && data.sdp) {
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          await flushIce(from, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emitSignal(from, { type: 'answer', sdp: pc.localDescription?.sdp });
        } else if (data.type === 'answer' && data.sdp) {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          await flushIce(from, pc);
        } else if (data.type === 'ice' && data.candidate) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(data.candidate);
          } else {
            (pendingIceRef.current[from] ??= []).push(data.candidate);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'A connection to another participant failed');
      }
    },
    // flushIce is defined below and only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionFor, emitSignal]
  );

  async function flushIce(peerId: string, pc: RTCPeerConnection) {
    const queued = pendingIceRef.current[peerId] ?? [];
    delete pendingIceRef.current[peerId];
    for (const candidate of queued) await pc.addIceCandidate(candidate);
  }

  /** Join a room on the server, then connect to everyone already in it. */
  const joinRoom = useCallback(
    (name: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      roomRef.current = name;
      setRoom(name);
      socket.emit(
        'huddle:join',
        { huddle_id: huddleId, room: name },
        (res: { ok: boolean; peers?: string[]; message?: string; can_speak?: boolean }) => {
          if (!res.ok) {
            setError(res.message ?? 'Could not join the room');
            return;
          }
          if (typeof res.can_speak === 'boolean' && localRef.current) {
            // The server's seat rule wins over anything stale on the client.
            setSpeakingAllowed(res.can_speak);
          }
          for (const peerId of res.peers ?? []) {
            setPeer(peerId, {});
            void offerTo(peerId).catch(() => setError('Could not connect to a participant'));
          }
          setStatus('live');
        }
      );
    },
    [huddleId, offerTo, setPeer]
  );

  const leaveCurrentRoom = useCallback(() => {
    socketRef.current?.emit('huddle:leave', { huddle_id: huddleId, room: roomRef.current });
    for (const id of Object.keys(pcsRef.current)) dropPeer(id);
    setPeers({});
  }, [huddleId, dropPeer]);

  useEffect(() => setSpeakingAllowed(canSpeak), [canSpeak]);
  const applyTracks = useCallback(() => {
    const stream = localRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = micOn && speakingAllowed && !mutedByHost));
    stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
  }, [micOn, camOn, speakingAllowed, mutedByHost]);
  useEffect(() => applyTracks(), [applyTracks, localStream]);

  // Set up media and the socket once per huddle.
  useEffect(() => {
    let cancelled = false;
    const token = getStoredAuthToken();
    if (!token) {
      setStatus('error');
      setError('Sign in to join the room');
      return;
    }

    (async () => {
      // Camera and microphone. If both are refused, the user still hears and sees the room.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          stream = new MediaStream();
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);
      setMicOn(stream.getAudioTracks().length > 0);
      setCamOn(stream.getVideoTracks().length > 0);

      const url = await getCcsWsUrl();
      if (cancelled) return;
      const socket = io(url, { auth: { token }, path: '/socket.io', reconnection: true });
      socketRef.current = socket;
      socket.on('connect_error', (e) => {
        setStatus('error');
        setError(e.message || 'Could not reach the room server');
      });
      socket.on('huddle:peer-joined', ({ user_id }: { user_id: string }) => {
        setPeer(user_id, {});
        void offerTo(user_id).catch(() => setError('Could not connect to a participant'));
      });
      socket.on('huddle:peer-left', ({ user_id }: { user_id: string }) => dropPeer(user_id));
      socket.on('huddle:signal', ({ from, data }: { from: string; data: Parameters<typeof handleSignal>[1] }) => {
        void handleSignal(from, data);
      });
      socket.on('huddle:chat', (msg: { from: string; room: string; text: string; at: string }) => {
        chatIdRef.current += 1;
        setChat((cur) => [...cur.slice(-199), { id: chatIdRef.current, ...msg }]);
      });
      socket.on('huddle:muted', ({ muted }: { muted: boolean }) => setMutedByHost(muted));
      socket.on('huddle:assigned', ({ room: next }: { room: string }) => {
        if (next === roomRef.current) return;
        leaveCurrentRoom();
        joinRoom(next);
      });
      // On reconnect the server has forgotten this socket's rooms: clear the stale mesh and rejoin.
      socket.on('connect', () => {
        for (const id of Object.keys(pcsRef.current)) dropPeer(id);
        setPeers({});
        joinRoom(roomRef.current);
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.emit('huddle:leave', { huddle_id: huddleId, room: roomRef.current });
      socketRef.current?.disconnect();
      socketRef.current = null;
      for (const id of Object.keys(pcsRef.current)) pcsRef.current[id].close();
      pcsRef.current = {};
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    };
    // The handlers read refs and stable callbacks; the room is set up once per huddle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huddleId]);

  // Host and co-host: the member list, for mute and breakout controls.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    const load = () => listHuddleMembers(huddleId).then((list) => !cancelled && setMembers(list)).catch(() => {});
    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canManage, huddleId]);

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    socketRef.current?.emit('huddle:chat', { huddle_id: huddleId, room: roomRef.current, text });
    setDraft('');
  }, [draft, huddleId]);

  const toggleMic = useCallback(() => {
    if (!speakingAllowed || mutedByHost) return;
    setMicOn((on) => !on);
  }, [speakingAllowed, mutedByHost]);

  const sendBreakout = useCallback(() => {
    const name = breakoutName.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(name) || picked.length === 0) {
      setError('Name the breakout room (lowercase letters, digits, hyphens) and pick people');
      return;
    }
    const assignments = Object.fromEntries(picked.map((id) => [id, name]));
    socketRef.current?.emit('huddle:breakout', { huddle_id: huddleId, assignments });
    setPicked([]);
  }, [breakoutName, picked, huddleId]);

  const bringEveryoneBack = useCallback(() => {
    const assignments = Object.fromEntries(members.filter((m) => m.admitted && m.user_id !== myId).map((m) => [m.user_id, MAIN_ROOM]));
    socketRef.current?.emit('huddle:breakout', { huddle_id: huddleId, assignments });
  }, [members, myId, huddleId]);

  const muteMember = useCallback(
    (targetId: string, muted: boolean) => {
      socketRef.current?.emit('huddle:mute', { huddle_id: huddleId, target: targetId, muted });
    },
    [huddleId]
  );

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.username ?? 'Participant';
  const roomChat = chat.filter((c) => c.room === room);

  return (
    <section className="dash-huddles-card-section" aria-label="Huddle room">
      <h2 className="dash-huddles-section-title">Room{room !== MAIN_ROOM ? ` · breakout: ${room}` : ''}</h2>
      {status === 'connecting' && <p className="dash-huddles-create-hint">Connecting…</p>}
      {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}

      <div className="huddle-room-grid">
        {localStream && (
          <VideoTile stream={localStream} label="You" muted />
        )}
        {Object.entries(peers).map(([id, p]) => (
          <VideoTile key={id} stream={p.stream} label={nameOf(id)} />
        ))}
      </div>

      <div className="huddle-room-controls">
        <button type="button" className="dash-huddles-create-opt" onClick={toggleMic} disabled={!speakingAllowed || mutedByHost}
          title={!speakingAllowed ? 'Ask the host to let you speak' : mutedByHost ? 'Muted by the host' : undefined}>
          {micOn ? 'Mute mic' : 'Unmute mic'}
        </button>{' '}
        <button type="button" className="dash-huddles-create-opt" onClick={() => setCamOn((on) => !on)}>
          {camOn ? 'Turn camera off' : 'Turn camera on'}
        </button>
        {!speakingAllowed && <span className="dash-huddles-create-hint"> You are listening. The host can let you speak.</span>}
        {mutedByHost && <span className="dash-huddles-create-hint"> The host muted you.</span>}
      </div>

      <div className="huddle-room-chat" aria-label="Room chat">
        <div className="huddle-room-chat-log">
          {roomChat.length === 0 && <p className="dash-huddles-create-hint">No messages yet.</p>}
          {roomChat.map((c) => (
            <p key={c.id}><strong>{c.from === myId ? 'You' : nameOf(c.from)}:</strong> {c.text}</p>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="dash-huddles-create-report-row">
          <input className="dash-huddles-create-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message this room" maxLength={500} aria-label="Message" />
          <button type="submit" className="dash-huddles-create-btn dash-huddles-create-btn--secondary">Send</button>
        </form>
      </div>

      {canManage && (
        <div className="huddle-room-host">
          <h3 className="dash-huddles-create-card-title">Breakout rooms</h3>
          <p className="dash-huddles-create-hint">Move people into a named room, then bring them back to the main room.</p>
          <div className="dash-huddles-create-report-row">
            <input className="dash-huddles-create-input" value={breakoutName} onChange={(e) => setBreakoutName(e.target.value)} placeholder="room name, e.g. team-a" aria-label="Breakout room name" />
            <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={sendBreakout}>Move selected</button>
            <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={bringEveryoneBack}>Bring everyone back</button>
          </div>
          <ul className="dash-huddles-create-invitees">
            {members.filter((m) => m.admitted && m.user_id !== myId).map((m) => (
              <li key={m.user_id}>
                <label>
                  <input type="checkbox" checked={picked.includes(m.user_id)} onChange={() => setPicked((cur) => (cur.includes(m.user_id) ? cur.filter((x) => x !== m.user_id) : [...cur, m.user_id]))} />{' '}
                  {m.username ?? 'User'}
                </label>{' '}
                {m.role !== 'host' && (
                  <>
                    <button type="button" className="dash-huddles-create-opt" onClick={() => muteMember(m.user_id, true)}>Mute</button>{' '}
                    <button type="button" className="dash-huddles-create-opt" onClick={() => muteMember(m.user_id, false)}>Unmute</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One video tile. The local tile is muted so you do not hear yourself. */
function VideoTile({ stream, label, muted = false }: { stream: MediaStream | null; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className="huddle-room-tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
