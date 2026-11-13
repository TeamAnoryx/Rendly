'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { TokenAmount } from '@/components/brand/TokenCoin';
import { inviteSparkPartner, type SparkMatched, type SparkMode } from '@/services/sparkApi';
import { sparkChannel, useSparkEvent } from '@/hooks/useSparkChannel';
import { useSparkMedia } from '@/hooks/useSparkMedia';
import './spark-room.css';

export type SparkRoomProps = {
  match: SparkMatched;
  myMode: SparkMode;
  onSkip: () => void;
  onLeave: () => void;
  /** I joined anonymously. Direct (non-relayed) video needs my consent first. Defaults to true. */
  selfAnonymous?: boolean;
};

type ChatLine = { id: string; mine: boolean; text: string; at: string; pending?: boolean };

const MAX_CHAT = 1000;
const TYPING_IDLE_MS = 1500;
const MAX_LINES = 300;

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function endedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'skip':
      return 'Your match moved on to someone new.';
    case 'leave':
    case 'close':
    case 'disconnect':
      return 'Your match left the session.';
    default:
      return 'This Spark session has ended.';
  }
}

/** Attaches a MediaStream to a <video>, tolerating autoplay rejections. */
function StreamVideo({
  stream,
  muted,
  className,
  label,
  onAutoplayBlocked,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className: string;
  label: string;
  onAutoplayBlocked?: (blocked: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    el.play()
      .then(() => onAutoplayBlocked?.(false))
      .catch(() => onAutoplayBlocked?.(true));
  }, [stream, onAutoplayBlocked]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} aria-label={label} />;
}

export function SparkRoom(props: SparkRoomProps): JSX.Element {
  const { match, myMode, onSkip, onLeave, selfAnonymous = true } = props;
  const reduce = useReducedMotion() ?? false;
  const media = useSparkMedia({
    initiator: match.initiator,
    myMode,
    selfAnonymous,
    partnerAnonymous: match.partner.anonymous,
  });
  const { partner } = match;
  const initial = (partner.display_name?.trim()?.[0] ?? '?').toUpperCase();

  // ---- chat ---------------------------------------------------------------
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  const mineIds = useRef<Set<string>>(new Set());
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  const [endedReason, setEndedReason] = useState<string | null>(null);

  useSparkEvent('spark:chat', (m) => {
    if (!m || typeof m.text !== 'string') return;
    if (m.client_id && mineIds.current.has(m.client_id)) {
      setLines((prev) => prev.map((l) => (l.id === m.client_id ? { ...l, pending: false, at: m.at || l.at } : l)));
      return;
    }
    const line: ChatLine = {
      id: m.client_id || newClientId(),
      mine: false,
      text: m.text.slice(0, MAX_CHAT),
      at: m.at || new Date().toISOString(),
    };
    setLines((prev) => [...prev, line].slice(-MAX_LINES));
    setPartnerTyping(false);
    if (!chatOpenRef.current) setUnread((n) => n + 1);
  });
  useSparkEvent('spark:typing', (m) => setPartnerTyping(!!m?.typing));
  useSparkEvent('spark:ended', (m) => {
    setEndedReason(m?.reason || 'ended');
    setPartnerTyping(false);
  });

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, partnerTyping]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  const stopTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (typingSent.current) {
      typingSent.current = false;
      sparkChannel.typing(false);
    }
  }, []);

  const onDraftChange = (value: string) => {
    setDraft(value.slice(0, MAX_CHAT));
    if (endedReason) return;
    if (!typingSent.current && value.trim()) {
      typingSent.current = true;
      sparkChannel.typing(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const send = () => {
    const text = draft.trim().slice(0, MAX_CHAT);
    if (!text || endedReason) return;
    const id = newClientId();
    mineIds.current.add(id);
    setLines((prev) => [...prev, { id, mine: true, text, at: new Date().toISOString(), pending: false }].slice(-MAX_LINES));
    setDraft('');
    stopTyping();
    sparkChannel.chat(text, id);
  };

  const toggleChat = () => {
    // Only the stacked (portrait / narrow) layout collapses the chat; keep in sync with spark-room.css.
    const stacked =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(max-width: 1024px) and (orientation: portrait), (max-width: 760px)').matches;
    if (!stacked) return;
    setChatOpen((o) => !o);
    setUnread(0);
  };

  // ---- invite -------------------------------------------------------------
  const [invite, setInvite] = useState<{ state: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({
    state: 'idle',
  });
  const sendInvite = async () => {
    if (invite.state === 'sending' || invite.state === 'sent') return;
    setInvite({ state: 'sending' });
    try {
      await inviteSparkPartner();
      setInvite({ state: 'sent' });
    } catch (err) {
      setInvite({ state: 'error', message: err instanceof Error ? err.message : 'Could not send the invite' });
    }
  };

  // ---- banner / audio -----------------------------------------------------
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteVideoRef = useRef<HTMLDivElement | null>(null);
  const showBanner = myMode === 'text' && media.partner.video && !media.camOn && !bannerDismissed && !endedReason;

  const unlockAudio = () => {
    const el = remoteVideoRef.current?.querySelector('video');
    el?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
  };

  // ---- actions ------------------------------------------------------------
  const skip = () => {
    stopTyping();
    media.leave('skip');
    onSkip();
  };
  const leave = () => {
    stopTyping();
    media.leave('leave');
    onLeave();
  };

  const ended = !!endedReason || media.ended;
  const showRemoteVideo = media.partnerVideoLive && !ended;
  const connecting =
    !ended &&
    media.videoGate === 'ready' &&
    media.connection !== 'connected' &&
    (media.partner.video || media.partner.audio);
  const gateCard = ended ? null : media.videoGate;

  const enter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, y: 14, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
      };

  return (
    <motion.section
      className={`sr ${chatOpen ? '' : 'sr--chat-closed'}`}
      aria-label="Spark session"
      {...enter}
    >
      <header className="sr-head">
        <div className="sr-intents" aria-label="Shared intents">
          {match.shared_intents.map((i) => (
            <span key={i} className="sr-chip">
              #{i.replace(/\s+/g, '')}
            </span>
          ))}
          {match.cost_charged > 0 && (
            <span className="sr-cost" title="Tokens charged for this match">
              <TokenAmount amount={match.cost_charged} size={12} /> charged
            </span>
          )}
        </div>
        <div className="sr-head-actions">
          <button type="button" className="rd-btn rd-btn--sm" onClick={skip}>
            <Icon name="skip" size={15} /> Skip
          </button>
          <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" onClick={leave}>
            <Icon name="logout" size={15} /> Leave
          </button>
        </div>
      </header>

      <div className="sr-main">
        <div className="sr-stage-col">
          <AnimatePresence>
            {showBanner && (
              <motion.div
                className="sr-banner"
                role="status"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Icon name="video" size={16} />
                <span>Your match is on video — turn on your camera for a richer session</span>
                <button
                  type="button"
                  className="rd-btn rd-btn--sm rd-btn--primary"
                  onClick={media.toggleCam}
                  disabled={media.busy !== null}
                >
                  Turn on camera
                </button>
                <button
                  type="button"
                  className="sr-icon-btn"
                  aria-label="Dismiss"
                  onClick={() => setBannerDismissed(true)}
                >
                  <Icon name="close" size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {gateCard === 'need-consent' && (
            <div className="sr-gate" role="region" aria-label="Direct video">
              <Icon name="video" size={16} />
              <p className="sr-gate-text">
                Video connects directly and can show your match your network location. Allow direct video?
              </p>
              <div className="sr-gate-actions">
                <button type="button" className="rd-btn rd-btn--sm rd-btn--primary" onClick={media.allowDirect}>
                  Allow
                </button>
                <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" onClick={media.declineDirect}>
                  Text only
                </button>
              </div>
            </div>
          )}
          {gateCard === 'waiting-partner' && (
            <div className="sr-gate" role="status">
              <Icon name="video" size={16} />
              <p className="sr-gate-text">Waiting for your match to allow video. Chat is open.</p>
            </div>
          )}
          {gateCard === 'declined' && (
            <div className="sr-gate sr-gate--quiet" role="status">
              <p className="sr-gate-text">Text only. Your network location stays private.</p>
              <div className="sr-gate-actions">
                <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" onClick={media.allowDirect}>
                  Allow direct video
                </button>
              </div>
            </div>
          )}

          <div className="sr-stage" ref={remoteVideoRef}>
            <StreamVideo
              stream={media.remoteStream}
              muted={false}
              className={`sr-remote ${showRemoteVideo ? 'is-on' : ''}`}
              label="Your match's video"
              onAutoplayBlocked={setAudioBlocked}
            />
            {!showRemoteVideo && (
              <div className="sr-placeholder" aria-hidden={ended}>
                <div className={`sr-avatar ${reduce ? '' : 'is-anim'}`}>
                  <span>{initial}</span>
                </div>
                <p className="sr-placeholder-label">
                  <Icon name="video" size={14} /> Camera off
                </p>
                {connecting && <p className="sr-placeholder-sub">Connecting…</p>}
              </div>
            )}

            {media.camOn && media.localStream && !ended && (
              <motion.div
                className="sr-self"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <StreamVideo stream={media.localStream} muted className="sr-self-video" label="Your camera" />
              </motion.div>
            )}

            {media.partner.audio && !media.partner.video && !ended && (
              <span className="sr-badge">
                <Icon name="mic" size={12} /> Mic on
              </span>
            )}

            {audioBlocked && !ended && (
              <button type="button" className="sr-unmute rd-btn rd-btn--sm" onClick={unlockAudio}>
                Tap to enable sound
              </button>
            )}

            {!ended && (
              <div className="sr-controls" role="toolbar" aria-label="Media controls">
                <button
                  type="button"
                  className={`sr-ctl ${media.micOn ? 'is-on' : 'is-off'}`}
                  onClick={media.toggleMic}
                  disabled={media.busy !== null}
                  aria-pressed={media.micOn}
                  aria-label={media.micOn ? 'Turn microphone off' : 'Turn microphone on'}
                >
                  <Icon name="mic" size={18} />
                </button>
                <button
                  type="button"
                  className={`sr-ctl ${media.camOn ? 'is-on' : 'is-off'}`}
                  onClick={media.toggleCam}
                  disabled={media.busy !== null}
                  aria-pressed={media.camOn}
                  aria-label={media.camOn ? 'Turn camera off' : 'Turn camera on'}
                >
                  <Icon name="video" size={18} />
                </button>
              </div>
            )}

            <AnimatePresence>
              {ended && (
                <motion.div
                  className="sr-ended"
                  role="alertdialog"
                  aria-label="Session ended"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <p className="sr-ended-title">{endedMessage(endedReason ?? undefined)}</p>
                  <div className="sr-ended-actions">
                    <button type="button" className="rd-btn rd-btn--primary" onClick={onSkip}>
                      <Icon name="spark" size={16} /> Find another
                    </button>
                    <button type="button" className="rd-btn rd-btn--ghost" onClick={onLeave}>
                      <Icon name="back" size={16} /> Back
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {media.error && (
            <p className="sr-error" role="alert">
              {media.error}
              <button type="button" className="sr-icon-btn" aria-label="Dismiss" onClick={media.clearError}>
                <Icon name="close" size={12} />
              </button>
            </p>
          )}

          <div className="sr-identity">
            {partner.anonymous ? (
              <span className="sr-name">@Anonymous</span>
            ) : (
              <span className="sr-name">{partner.display_name}</span>
            )}
            {!partner.anonymous && partner.can_invite && (
              <span className="sr-invite">
                {invite.state === 'sent' ? (
                  <span className="sr-invite-ok">
                    <Icon name="check" size={14} /> Invite sent
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rd-btn rd-btn--sm"
                    onClick={sendInvite}
                    disabled={invite.state === 'sending'}
                  >
                    <Icon name="plus" size={14} /> {invite.state === 'sending' ? 'Sending…' : 'Invite to connect'}
                  </button>
                )}
                {invite.state === 'error' && <span className="sr-invite-err">{invite.message}</span>}
              </span>
            )}
          </div>
        </div>

        <aside className="sr-chat" aria-label="Session chat">
          <button type="button" className="sr-chat-toggle" onClick={toggleChat} aria-expanded={chatOpen}>
            <Icon name="chat" size={15} /> Chat
            {unread > 0 && <span className="sr-unread">{unread}</span>}
            <span className="sr-chat-hint">Not saved</span>
          </button>
          <div className="sr-chat-body">
            {partner.note && (
              <div className="sr-note">
                <p className="sr-note-title">Their note</p>
                <p className="sr-note-text">{partner.note}</p>
              </div>
            )}
            <div className="sr-list" ref={listRef} aria-live="polite">
              {lines.length === 0 && <p className="sr-empty">Say hi — messages disappear when the session ends.</p>}
              {lines.map((l) => (
                <div key={l.id} className={`sr-msg ${l.mine ? 'is-mine' : ''}`}>
                  <p className="sr-msg-text">{l.text}</p>
                  <span className="sr-msg-time">{formatTime(l.at)}</span>
                </div>
              ))}
              {partnerTyping && !ended && (
                <div className="sr-typing" aria-label="Your match is typing">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
            <form
              className="sr-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                value={draft}
                maxLength={MAX_CHAT}
                rows={1}
                placeholder={ended ? 'Session ended' : 'Write a message…'}
                disabled={ended}
                aria-label="Message"
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="submit"
                className="rd-btn rd-btn--primary rd-btn--sm"
                disabled={ended || !draft.trim()}
                aria-label="Send"
              >
                <Icon name="send" size={16} />
              </button>
            </form>
          </div>
        </aside>
      </div>
    </motion.section>
  );
}

export default SparkRoom;
