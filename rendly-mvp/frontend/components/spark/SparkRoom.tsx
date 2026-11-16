'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { TokenAmount } from '@/components/brand/TokenCoin';
import { inviteSparkPartner, type SparkMatched, type SparkMode } from '@/services/sparkApi';
import { sparkChannel, useSparkEvent } from '@/hooks/useSparkChannel';
import { useSparkMedia } from '@/hooks/useSparkMedia';
import { formatResetsIn, notifySparkLimitsChanged, useSparkLimits } from '@/hooks/useSparkLimits';
import { useMatchCharge } from '@/hooks/useMatchCharge';
import ChargeNotice, { ChargeChip, markChargeNoticeSeen, shouldShowChargeNotice } from '@/components/spark/ChargeNotice';
import { usePathname } from 'next/navigation';
import { PausedOverlay, useFreezeVideo } from '@/components/call/OngoingCard';
import { pauseLabelFor } from '@/lib/mediaPause';
import { useOngoingNotification } from '@/hooks/useOngoingNotification';
import { consumeResumeParam } from '@/lib/resumeParam';
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
/** Wait for the server-side DELETE/settle before refetching limits after a match ends. */
const LIMITS_REFRESH_DELAY_MS = 600;

function limitsTitle(maxPerWindow: number, windowMinutes: number, resetsAt: string | null): string {
  const resets = formatResetsIn(resetsAt);
  const rule = `${maxPerWindow} matches per ${windowMinutes} minutes`;
  return resets ? `${resets} · ${rule}` : rule;
}

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
  frozen = false,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className: string;
  label: string;
  onAutoplayBlocked?: (blocked: boolean) => void;
  /** Hold the last frame (the other side paused). */
  frozen?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useFreezeVideo(ref, frozen, stream);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream || frozen) return;
    el.play()
      .then(() => onAutoplayBlocked?.(false))
      .catch(() => onAutoplayBlocked?.(true));
  }, [stream, onAutoplayBlocked, frozen]);
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
  const pathname = usePathname() ?? '/dashboard/match';
  const partnerPausedLabel = pauseLabelFor(media.partnerPaused);
  const { setPaused } = media;
  const initial = (partner.display_name?.trim()?.[0] ?? '?').toUpperCase();

  // ---- limits + deferred charge ------------------------------------------
  const { limits, refresh: refreshLimits } = useSparkLimits();
  const charge = useMatchCharge(match.charge);
  const { markEnded } = charge;
  const scheduleLimitsRefresh = useCallback(() => {
    setTimeout(() => notifySparkLimitsChanged(), LIMITS_REFRESH_DELAY_MS);
  }, []);
  const seedLimits = useRef(match.limits);
  useEffect(() => {
    if (seedLimits.current) notifySparkLimitsChanged(seedLimits.current);
    void refreshLimits();
  }, [refreshLimits]);

  const [noticeOpen, setNoticeOpen] = useState(false);
  useEffect(() => {
    if (!shouldShowChargeNotice()) return;
    markChargeNoticeSeen();
    setNoticeOpen(true);
  }, []);
  useEffect(() => {
    if (noticeOpen && (charge.state !== 'pending' || charge.secondsLeft <= 0)) setNoticeOpen(false);
  }, [noticeOpen, charge.state, charge.secondsLeft]);

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
    markEnded();
    void refreshLimits();
    scheduleLimitsRefresh();
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
  // Offer my camera only once video can actually flow; the gate card handles consent before that.
  const showBanner =
    media.videoGate === 'ready' && media.partner.video && !media.camOn && !bannerDismissed && !endedReason;

  const unlockAudio = () => {
    const el = remoteVideoRef.current?.querySelector('video');
    el?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
  };

  // ---- ongoing notification / resume ---------------------------------------
  const live = !endedReason && !media.ended;
  useOngoingNotification(
    live ? { title: 'Ongoing Spark', body: `With ${partner.display_name || 'your match'}. Tap to return.`, path: pathname } : null,
    () => setPaused(false),
  );
  // Opened from the ongoing notification (?resume=1): unpause and drop the param.
  useEffect(() => {
    if (consumeResumeParam()) setPaused(false);
  }, [setPaused]);

  // ---- actions ------------------------------------------------------------
  const handleSkip = () => {
    markEnded();
    onSkip();
    scheduleLimitsRefresh();
  };
  const handleLeave = () => {
    markEnded();
    onLeave();
    scheduleLimitsRefresh();
  };
  const skip = () => {
    stopTyping();
    media.leave('skip');
    handleSkip();
  };
  const leave = () => {
    stopTyping();
    media.leave('leave');
    handleLeave();
  };

  const ended = !!endedReason || media.ended;
  useEffect(() => {
    if (ended) markEnded();
  }, [ended, markEnded]);
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
          <ChargeChip
            className="sr-charge"
            state={charge.state}
            secondsLeft={charge.secondsLeft}
            cost={charge.cost || match.cost_charged}
          />
        </div>
        <div className="sr-head-actions">
          {limits ? (
            <div
              className="sr-limits"
              title={limitsTitle(limits.max_per_window, limits.window_minutes, limits.resets_at)}
            >
              <span className="sr-limits-balance" aria-label={`Balance ${limits.balance} tokens`}>
                <TokenAmount amount={limits.balance} size={12} />
              </span>
              <span className="sr-limits-sep" aria-hidden="true" />
              <span className="sr-limits-left">
                {limits.matches_left}
                <span className="sr-limits-word"> matches</span> left
              </span>
            </div>
          ) : (
            <span className="sr-limits sr-limits--skeleton" aria-hidden="true" />
          )}
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

          <AnimatePresence initial={false}>
            {gateCard === 'partner-wants-video' && (
              <motion.div
                key="gate-ask"
                className="sr-gate"
                role="region"
                aria-label="Your match turned on video"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Icon name="video" size={16} />
                <p className="sr-gate-text">
                  <strong>Your match turned on {media.partner.video ? 'their camera' : 'their mic'}.</strong> Video
                  connects you directly, which can show your match your network location.
                </p>
                <div className="sr-gate-actions">
                  <button type="button" className="rd-btn rd-btn--sm rd-btn--primary" onClick={media.allowDirect}>
                    Allow video
                  </button>
                  <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" onClick={media.declineDirect}>
                    Text only
                  </button>
                </div>
              </motion.div>
            )}
            {gateCard === 'waiting-partner' && (
              <motion.div
                key="gate-wait"
                className="sr-gate sr-gate--quiet"
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Icon name="video" size={16} />
                <p className="sr-gate-text">Your camera is on. Your match sees you as soon as they allow video.</p>
              </motion.div>
            )}
            {gateCard === 'declined' && (
              <motion.div
                key="gate-declined"
                className="sr-gate sr-gate--quiet"
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="sr-gate-text">Text only. Your network location stays private.</p>
                <div className="sr-gate-actions">
                  <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" onClick={media.allowDirect}>
                    Allow video
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="sr-stage" ref={remoteVideoRef}>
            <div className="sr-charge-slot">
              <ChargeNotice
                open={noticeOpen && !ended}
                secondsLeft={charge.secondsLeft}
                progress={charge.progress}
                onDismiss={() => setNoticeOpen(false)}
              />
            </div>
            <StreamVideo
              stream={media.remoteStream}
              muted={false}
              className={`sr-remote ${showRemoteVideo ? 'is-on' : ''}`}
              label="Your match's video"
              onAutoplayBlocked={setAudioBlocked}
              frozen={!!partnerPausedLabel && !ended}
            />
            {!ended ? <PausedOverlay label={partnerPausedLabel} /> : null}
            {!showRemoteVideo && (
              <div className="sr-placeholder" aria-hidden={ended}>
                <div className={`sr-avatar ${reduce ? '' : 'is-anim'}`}>
                  <span>{initial}</span>
                </div>
                <p className="sr-placeholder-label">
                  <Icon name="video" size={14} /> {media.partner.video && !ended ? 'Camera on' : 'Camera off'}
                </p>
                {media.partner.video && !ended && media.videoGate !== 'ready' ? (
                  <p className="sr-placeholder-sub">Allow video above to see your match</p>
                ) : connecting || (media.partner.video && !ended) ? (
                  <p className="sr-placeholder-sub">Connecting…</p>
                ) : null}
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
                <button
                  type="button"
                  className={`sr-ctl ${media.paused ? 'is-off' : 'is-on'}`}
                  onClick={media.togglePause}
                  aria-pressed={media.paused}
                  aria-label={media.paused ? 'Resume' : 'Pause'}
                  title={media.paused ? 'Resume' : 'Pause camera and mic'}
                >
                  <Icon name={media.paused ? 'play' : 'pause'} size={18} />
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
                  <ChargeChip
                    className="sr-charge sr-charge--ended"
                    state={charge.state}
                    secondsLeft={charge.secondsLeft}
                    cost={charge.cost || match.cost_charged}
                  />
                  <div className="sr-ended-actions">
                    <button type="button" className="rd-btn rd-btn--primary" onClick={handleSkip}>
                      <Icon name="spark" size={16} /> Find another
                    </button>
                    <button type="button" className="rd-btn rd-btn--ghost" onClick={handleLeave}>
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
