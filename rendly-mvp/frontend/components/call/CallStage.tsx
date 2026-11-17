'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useCallContext } from '@/context/CallContext';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { useNotifications } from '@/context/NotificationsContext';
import { getUserCard, otherPartyOf, type UserCard } from '@/services/usersApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import { VideoTile } from './VideoTile';
import { CallMiniBar } from './CallMiniBar';
import { pauseLabelFor } from '@/lib/mediaPause';
import { useOngoingNotification } from '@/hooks/useOngoingNotification';
import { useRoomRecorder, type RecordSource } from '@/hooks/useRoomRecorder';
import './call.css';
import { withBasePath } from '@/lib/basePath';

const RINGTONE = withBasePath('/sounds/ringtone-audio.mp3');

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

/** Browser-side recording of a 1:1 call: both cameras (or avatars for voice) plus both voices. */
function useCallRecorder(peerName: string) {
  const c = useCallContext();
  const latest = useRef({ remote: c.remoteStream, local: c.localStream, peerName });
  latest.current = { remote: c.remoteStream, local: c.localStream, peerName };
  return useRoomRecorder((): RecordSource[] => [
    { id: 'peer', stream: latest.current.remote, name: latest.current.peerName },
    { id: 'me', stream: latest.current.local, name: 'You' },
  ]);
}

function callRecordingName(peerName: string, kind: string, at: Date): string {
  const slug = peerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'call';
  return `rendly-${kind}-call-${slug}-${at.toISOString().slice(0, 16).replace(':', '-')}.webm`;
}

export function CallControls({
  compact = false,
  onMinimize,
  recorder,
  peerName = 'call',
}: {
  compact?: boolean;
  onMinimize?: () => void;
  recorder?: ReturnType<typeof useRoomRecorder>;
  peerName?: string;
}) {
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
      {c.callState === 'active' ? (
        <button type="button" className={`call-ctl ${c.isPaused ? 'call-ctl--off' : ''}`} onClick={c.togglePause} aria-label={c.isPaused ? 'Resume call' : 'Pause call'} aria-pressed={c.isPaused} title={c.isPaused ? 'Resume' : 'Pause'}>
          <Icon name={c.isPaused ? 'play' : 'pause'} />
        </button>
      ) : null}
      {recorder && c.callState === 'active' ? (
        <button
          type="button"
          className={`call-ctl ${recorder.recording ? 'call-ctl--rec' : ''}`}
          onClick={() =>
            recorder.recording
              ? recorder.stop()
              : void recorder.start(callRecordingName(peerName, c.callType === 'video' ? 'video' : 'voice', new Date()))
          }
          aria-label={recorder.recording ? 'Stop recording and save' : 'Record call'}
          aria-pressed={recorder.recording}
          title={recorder.recording ? 'Stop recording' : 'Record'}
        >
          <Icon name="record" />
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
  const peerPaused = pauseLabelFor(c.peerPaused);
  const mePaused = c.isPaused ? 'Paused' : null;
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
          <VideoTile stream={c.remoteStream} label={peerName} avatarUrl={peer?.avatar_url} pausedLabel={peerPaused} />
          <VideoTile stream={c.localStream} label="You" avatarUrl={user?.avatar_url} muted mirror forceAvatar={c.isVideoOff} pausedLabel={mePaused} />
        </div>
      </div>
    );
  }

  return (
    <div className="call-media">
      <VideoTile stream={c.remoteStream} label={peerName} avatarUrl={peer?.avatar_url} className="call-tile--main" forceAvatar={audioOnly} pausedLabel={peerPaused} />
      {!audioOnly ? (
        <VideoTile stream={c.localStream} label="You" avatarUrl={user?.avatar_url} muted mirror className="call-tile--pip" forceAvatar={c.isVideoOff} pausedLabel={mePaused} />
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
  // In Whispers the call docks beside (or above) the chat so both stay visible.
  const docked = pathname.startsWith('/dashboard/chat');
  const recorder = useCallRecorder(peer?.username ? `@${peer.username}` : 'Them');
  const peerHandle = peer?.username ? `@${peer.username}` : 'Someone';
  const callKind = c.callType === 'video' ? 'video' : 'audio';

  // Phone lock / app switch mid-call: a notification brings the user back to the call.
  useOngoingNotification(
    c.callState === 'active'
      ? { title: `Ongoing ${callKind} call`, body: `With ${peerHandle}. Tap to return.`, path: `${pathname || '/dashboard'}` }
      : null,
    () => {
      setMinimized(false);
      c.setPaused(false);
    },
  );

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

  // Ending the call stops (and saves) any recording.
  useEffect(() => {
    if (c.callState !== 'active' && recorder.recording) recorder.stop();
  }, [c.callState, recorder]);

  // Whispers has a dock slot beside the chat; the call renders there instead of over the page.
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!docked) {
      setDockEl(null);
      return;
    }
    setDockEl(document.getElementById('rd-call-dock'));
  }, [docked, pathname, c.callState]);

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
      <CallMiniBar callType={callKind} peerName={peerName} elapsed={formatDuration(elapsed)} onResume={() => setMinimized(false)}>
        <CallControls compact recorder={recorder} peerName={peerName} />
      </CallMiniBar>
    );
  }

  const audioOnly = c.callType !== 'video';
  const stage = (
    <div
      className={`call-stage${dockEl ? ` call-stage--docked${audioOnly ? ' call-stage--docked-audio' : ''}` : ''}`} role="dialog" aria-label={`Call with ${peerName}`}>
      <header className="call-stage-head">
        <div>
          <strong>{peerName}</strong>
          <span className="rd-small rd-muted"> · {formatDuration(elapsed)}</span>
        </div>
        {recorder.recording ? (
          <span className="rd-chip call-rec-chip">
            <span className="call-rec-dot" aria-hidden /> Recording {formatDuration(recorder.seconds)}
          </span>
        ) : null}
        {recorder.error ? <span className="rd-chip">{recorder.error}</span> : null}
        {c.remoteScreenStream ? <span className="rd-chip">Viewing their screen</span> : null}
        {c.isScreenSharing ? <span className="rd-chip rd-chip--on">You are sharing</span> : null}
      </header>
      <CallMedia peer={peer} />
      {audioOnly && dockEl ? (
        <div className="call-audio-bar">
          <Avatar url={peer?.avatar_url} name={peer?.username} size="sm" />
          <div className="call-audio-bar-text">
            <strong>{peerName}</strong>
            <span className="rd-small rd-muted">Voice call · {formatDuration(elapsed)}</span>
          </div>
        </div>
      ) : null}
      <CallControls onMinimize={() => setMinimized(true)} recorder={recorder} peerName={peerName} />
    </div>
  );
  return dockEl ? createPortal(stage, dockEl) : stage;
}
