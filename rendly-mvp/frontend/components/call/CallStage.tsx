'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCallContext } from '@/context/CallContext';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { useNotifications } from '@/context/NotificationsContext';
import { getUserCard, otherPartyOf, type UserCard } from '@/services/usersApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import { VideoTile } from './VideoTile';
import './call.css';

const RINGTONE = '/sounds/ringtone-audio.mp3';

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The person on the other end of the current or incoming call. */
export function useCallPeer(): UserCard | null {
  const { conversationId, incomingCall } = useCallContext();
  const { user } = useCurrentUser();
  const [peer, setPeer] = useState<UserCard | null>(null);
  const peerId = incomingCall?.initiator_id ?? otherPartyOf(conversationId, user?.id);
  useEffect(() => {
    let alive = true;
    if (!peerId) {
      setPeer(null);
      return;
    }
    getUserCard(peerId).then((c) => alive && setPeer(c));
    return () => {
      alive = false;
    };
  }, [peerId]);
  return peer;
}

export function CallControls({ compact = false, onMinimize }: { compact?: boolean; onMinimize?: () => void }) {
  const c = useCallContext();
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
  return (
    <div className={`call-controls ${compact ? 'call-controls--compact' : ''}`}>
      <button type="button" className={`call-ctl ${c.isMuted ? 'call-ctl--off' : ''}`} onClick={c.toggleMute} aria-label={c.isMuted ? 'Unmute' : 'Mute'} title={c.isMuted ? 'Unmute' : 'Mute'}>
        <Icon name={c.isMuted ? 'mic-off' : 'mic'} />
      </button>
      {c.callType === 'video' ? (
        <button type="button" className={`call-ctl ${c.isVideoOff ? 'call-ctl--off' : ''}`} onClick={c.toggleVideo} aria-label={c.isVideoOff ? 'Turn camera on' : 'Turn camera off'} title="Camera">
          <Icon name={c.isVideoOff ? 'video-off' : 'video'} />
        </button>
      ) : null}
      {c.callType === 'video' && canShare ? (
        <button type="button" className={`call-ctl ${c.isScreenSharing ? 'call-ctl--on' : ''}`} onClick={() => void c.toggleScreenShare()} aria-label={c.isScreenSharing ? 'Stop sharing' : 'Share screen'} title="Share screen">
          <Icon name="screen" />
        </button>
      ) : null}
      {onMinimize ? (
        <button type="button" className="call-ctl" onClick={onMinimize} aria-label="Minimise call" title="Minimise">
          <Icon name="grid" />
        </button>
      ) : null}
      <button type="button" className="call-ctl call-ctl--end" onClick={c.endCall} aria-label="End call" title="End call">
        <Icon name="phone-off" />
      </button>
    </div>
  );
}

/** Camera tiles plus, when anyone shares, the shared screen as the main view. */
export function CallMedia({ peer }: { peer: UserCard | null }) {
  const c = useCallContext();
  const { user } = useCurrentUser();
  const peerName = peer?.username ? `@${peer.username}` : 'Them';
  const sharing = c.screenStream ?? c.remoteScreenStream;
  const audioOnly = c.callType === 'audio';

  if (sharing) {
    return (
      <div className="call-media call-media--share">
        <VideoTile
          stream={sharing}
          label={c.screenStream ? 'Your screen' : `${peerName}'s screen`}
          muted
          fit="contain"
          className="call-tile--screen"
        />
        <div className="call-strip">
          <VideoTile stream={c.remoteStream} label={peerName} avatarUrl={peer?.avatar_url} />
          <VideoTile stream={c.localStream} label="You" avatarUrl={user?.avatar_url} muted mirror forceAvatar={c.isVideoOff} />
        </div>
      </div>
    );
  }

  return (
    <div className="call-media">
      <VideoTile stream={c.remoteStream} label={peerName} avatarUrl={peer?.avatar_url} className="call-tile--main" forceAvatar={audioOnly} />
      {!audioOnly ? (
        <VideoTile stream={c.localStream} label="You" avatarUrl={user?.avatar_url} muted mirror className="call-tile--pip" forceAvatar={c.isVideoOff} />
      ) : null}
    </div>
  );
}

/**
 * Global call UI: incoming ring, outgoing "calling…", and the active call stage on every
 * dashboard page. The Spark match room shows its own stage, so this one stays out of the way there.
 */
export function CallStage() {
  const c = useCallContext();
  const pathname = usePathname() ?? '';
  const { pushToast } = useNotifications();
  const peer = useCallPeer();
  const [minimized, setMinimized] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ringRef = useRef<HTMLAudioElement | null>(null);
  const embedded = pathname.startsWith('/dashboard/match');

  // Errors (offline callee, declined, no camera) become a pop-up.
  useEffect(() => {
    if (!c.callError) return;
    pushToast({ icon: 'phone-off', title: "Call didn't connect", body: c.callError, durationMs: 7000 });
    c.clearCallError();
  }, [c.callError, c, pushToast]);

  // Ring while a call is incoming.
  useEffect(() => {
    if (c.callState !== 'ringing_incoming') return;
    const audio = new Audio(RINGTONE);
    audio.loop = true;
    audio.play().catch(() => undefined); // autoplay may be blocked until the user interacts
    ringRef.current = audio;
    return () => {
      audio.pause();
      ringRef.current = null;
    };
  }, [c.callState]);

  useEffect(() => {
    if (c.callState !== 'active') {
      setElapsed(0);
      setMinimized(false);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [c.callState]);

  const peerName = peer?.username ? `@${peer.username}` : 'Someone';

  if (c.callState === 'ringing_incoming' && c.incomingCall) {
    const video = c.incomingCall.call_type !== 'audio';
    return (
      <div className="call-incoming" role="alertdialog" aria-label={`Incoming ${video ? 'video' : 'voice'} call from ${peerName}`}>
        <div className="call-incoming-pulse">
          <Avatar url={peer?.avatar_url} name={peer?.username} size="lg" />
        </div>
        <div className="call-incoming-text">
          <strong>{peerName}</strong>
          <span className="rd-small rd-muted">Incoming {video ? 'video' : 'voice'} call…</span>
        </div>
        <div className="call-incoming-actions">
          <button type="button" className="call-ctl call-ctl--end" onClick={c.rejectCall} aria-label="Decline">
            <Icon name="phone-off" />
          </button>
          <button type="button" className="call-ctl call-ctl--accept" onClick={() => void c.acceptCall()} aria-label="Accept">
            <Icon name={video ? 'video' : 'phone'} />
          </button>
        </div>
      </div>
    );
  }

  if (embedded || c.callState === 'idle' || c.callState === 'ringing_incoming') return null;

  if (c.callState === 'ringing_outgoing') {
    return (
      <div className="call-outgoing" role="status">
        <div className="call-incoming-pulse">
          <Avatar url={peer?.avatar_url} name={peer?.username} size="lg" />
        </div>
        <div className="call-incoming-text">
          <strong>Calling {peerName}…</strong>
          <span className="rd-small rd-muted">{c.callType === 'video' ? 'Video call' : 'Voice call'}</span>
        </div>
        <button type="button" className="call-ctl call-ctl--end" onClick={c.endCall} aria-label="Cancel call">
          <Icon name="phone-off" />
        </button>
      </div>
    );
  }

  if (minimized) {
    return (
      <div className="call-mini" role="status">
        <button type="button" className="call-mini-open" onClick={() => setMinimized(false)} aria-label="Return to call">
          <span className="rd-badge rd-badge--live">LIVE</span>
          <span>{peerName}</span>
          <span className="rd-muted">{formatDuration(elapsed)}</span>
        </button>
        <CallControls compact />
      </div>
    );
  }

  return (
    <div className="call-stage" role="dialog" aria-label={`Call with ${peerName}`}>
      <header className="call-stage-head">
        <div>
          <strong>{peerName}</strong>
          <span className="rd-small rd-muted"> · {formatDuration(elapsed)}</span>
        </div>
        {c.remoteScreenStream ? <span className="rd-chip">Viewing their screen</span> : null}
        {c.isScreenSharing ? <span className="rd-chip rd-chip--on">You are sharing</span> : null}
      </header>
      <CallMedia peer={peer} />
      <CallControls onMinimize={() => setMinimized(true)} />
    </div>
  );
}
