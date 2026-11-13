'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getSparkStatus,
  joinSparkQueue,
  leaveSparkQueue,
  type SparkIntent,
  type SparkMode,
  type SparkView,
} from '@/services/sparkApi';
import { DASHBOARD_INTENTS, useDashboard } from '@/hooks/useDashboard';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { useCallContext } from '@/context/CallContext';
import { usePresence } from '@/context/SocketContext';
import websocket from '@/services/websocket';
import { sendConnectionInvite } from '@/services/connectionsApi';
import { Icon } from '@/components/shell/Icon';
import { Avatar } from '@/components/shell/AppShell';
import { CallControls, CallMedia } from '@/components/call/CallStage';
import './match.css';

const POLL_MS = 2000;
const INTENT_COPY: Record<SparkIntent, { blurb: string; icon: string }> = {
  'Light chat': { blurb: 'Easy talk, no agenda', icon: 'chat' },
  Brainstorm: { blurb: 'Bounce ideas around', icon: 'spark' },
  Motivation: { blurb: 'Get or give a push', icon: 'star' },
  Collaborate: { blurb: 'Find someone to build with', icon: 'people' },
};

type Matched = Extract<SparkView, { status: 'matched' }>;
type ChatLine = { id: string; mine: boolean; text: string; at: string };
type Phase = 'choose' | 'waiting' | 'room';

function ChooseStep({
  mode,
  setMode,
  intent,
  setIntent,
  onStart,
  busy,
  error,
  lookingNow,
}: {
  mode: SparkMode;
  setMode: (m: SparkMode) => void;
  intent: SparkIntent;
  setIntent: (i: SparkIntent) => void;
  onStart: () => void;
  busy: boolean;
  error: string | null;
  lookingNow: number | null;
}) {
  const intentCopy = INTENT_COPY[intent];
  return (
    <div className="spark-choose rd-stagger">
      <header className="spark-choose-head">
        <span className="spark-eyebrow">
          <Icon name="spark" size={14} /> Spark
        </span>
        <h1 className="rd-h1">Meet someone new, one on one</h1>
        <p className="spark-lede">Pick how you want to talk and why. We pair you with someone who picked the same.</p>
      </header>

      <div className="rd-card spark-panel">
        <div className="spark-field">
          <span className="spark-label" id="spark-mode-label">
            Format
          </span>
          <div className="spark-seg" role="radiogroup" aria-labelledby="spark-mode-label">
            {(['text', 'video'] as SparkMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`spark-seg-btn ${mode === m ? 'spark-seg-btn--on' : ''}`}
                onClick={() => setMode(m)}
              >
                <Icon name={m === 'text' ? 'chat' : 'video'} size={15} />
                {m === 'text' ? 'Text first' : 'Video'}
              </button>
            ))}
          </div>
          <p className="spark-help">{mode === 'text' ? 'Start in chat, switch to video any time.' : 'Face to face from the start.'}</p>
        </div>

        <div className="spark-field">
          <span className="spark-label" id="spark-intent-label">
            Intent
          </span>
          <div className="spark-chips" role="radiogroup" aria-labelledby="spark-intent-label">
            {DASHBOARD_INTENTS.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={intent === i}
                className={`rd-chip spark-chip ${intent === i ? 'rd-chip--on' : ''}`}
                onClick={() => setIntent(i as SparkIntent)}
              >
                <Icon name={INTENT_COPY[i as SparkIntent].icon} size={14} />
                {i}
              </button>
            ))}
          </div>
          <p className="spark-help">{intentCopy.blurb}.</p>
        </div>

        {error ? (
          <p className="spark-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="spark-panel-foot">
          <span className="spark-looking">
            {lookingNow ? (
              <>
                <span className="spark-live-dot" aria-hidden />
                <span className="spark-num">{lookingNow}</span> looking right now
              </>
            ) : (
              <>
                <Icon name="lock" size={13} /> Chats are temporary
              </>
            )}
          </span>
          <button type="button" className="rd-btn rd-btn--primary spark-go" onClick={onStart} disabled={busy}>
            {busy ? <span className="rd-spinner" /> : <Icon name="spark" size={15} />} Find someone
          </button>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(total: number): string {
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function WaitingStep({ mode, intent, elapsed, onCancel, busy }: { mode: SparkMode; intent: SparkIntent; elapsed: number; onCancel: () => void; busy: boolean }) {
  return (
    <div className="spark-waiting" role="status" aria-live="polite">
      <div className="spark-radar" aria-hidden>
        <span className="spark-radar-ring spark-radar-ring--1" />
        <span className="spark-radar-ring spark-radar-ring--2" />
        <span className="spark-radar-ring spark-radar-ring--3" />
        <span className="spark-radar-pulse" />
        <span className="spark-radar-pulse spark-radar-pulse--late" />
        <span className="spark-radar-core">
          <Icon name="spark" size={20} />
        </span>
      </div>
      <h2 className="spark-waiting-title">Finding someone for {intent}</h2>
      <div className="spark-waiting-meta">
        <span className="rd-badge">
          <Icon name={mode === 'video' ? 'video' : 'chat'} size={12} /> {mode === 'video' ? 'Video' : 'Text first'}
        </span>
        <span className="rd-badge">
          <Icon name={INTENT_COPY[intent].icon} size={12} /> {intent}
        </span>
        <span className="spark-elapsed" aria-label={`${elapsed} seconds`}>
          {formatElapsed(elapsed)}
        </span>
      </div>
      <button type="button" className="rd-btn spark-cancel" onClick={onCancel} disabled={busy}>
        {busy ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}

function MatchRoom({
  match,
  onSkip,
  onClose,
}: {
  match: Matched;
  onSkip: () => void;
  onClose: () => void;
}) {
  const call = useCallContext();
  const presence = usePresence();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [joined, setJoined] = useState<'pending' | 'ok' | 'failed'>('pending');
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [invite, setInvite] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  const [chatOpen, setChatOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerId = match.partner.id;
  const partnerName = match.partner.username ? `@${match.partner.username}` : 'Your match';
  const inThisCall = call.conversationId === match.conversation_id && call.callState !== 'idle';

  // Join the temporary chat room once the socket is up (and again after a reconnect).
  useEffect(() => {
    let cancelled = false;
    const join = async () => {
      if (!websocket.isConnected()) return;
      try {
        const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('spark:join', { partner_id: partnerId });
        if (!cancelled) setJoined(res?.ok ? 'ok' : 'failed');
      } catch {
        if (!cancelled) setJoined('failed');
      }
    };
    void join();
    const offStatus = websocket.onStatus((c) => c && void join());
    const offChat = websocket.on<{ from: string; text: string; client_id: string | null; at: string }>('spark:chat', (m) => {
      if (m.from !== partnerId) return;
      setPartnerTyping(false);
      setLines((l) => [...l, { id: m.client_id ?? `${m.at}_${l.length}`, mine: false, text: m.text, at: m.at }].slice(-300));
    });
    // Typing signals are best-effort, so the indicator also clears itself if "stopped" never arrives.
    let typingClear: ReturnType<typeof setTimeout> | null = null;
    const offTyping = websocket.on<{ from: string; typing: boolean }>('spark:typing', (m) => {
      if (m.from !== partnerId) return;
      setPartnerTyping(m.typing);
      if (typingClear) clearTimeout(typingClear);
      typingClear = m.typing ? setTimeout(() => setPartnerTyping(false), 4000) : null;
    });
    const offEnded = websocket.on<{ from: string; reason: string }>('spark:ended', (m) => {
      if (m.from !== partnerId) return;
      setEnded(m.reason === 'skip' ? `${partnerName} skipped.` : `${partnerName} left the match.`);
    });
    const offJoined = websocket.on<{ from: string }>('spark:partner-joined', (m) => m.from === partnerId && setEnded(null));
    return () => {
      cancelled = true;
      offStatus();
      offChat();
      offTyping();
      if (typingClear) clearTimeout(typingClear);
      offEnded();
      offJoined();
    };
  }, [partnerId, partnerName]);

  useEffect(() => {
    presence.watch([partnerId]);
  }, [partnerId, presence]);

  // Video matches: the initiator rings, the other side picks up automatically (both chose video).
  const autoCallRef = useRef(false);
  useEffect(() => {
    if (match.mode !== 'video' || autoCallRef.current || joined !== 'ok') return;
    if (match.initiator && call.callState === 'idle') {
      autoCallRef.current = true;
      void call.startCall(match.conversation_id, 'video');
    }
  }, [match, joined, call]);
  useEffect(() => {
    if (match.mode !== 'video') return;
    if (call.callState === 'ringing_incoming' && call.incomingCall?.conversation_id === match.conversation_id) {
      void call.acceptCall();
    }
  }, [match, call]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, partnerTyping]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setDraft('');
    setLines((l) => [...l, { id, mine: true, text, at: new Date().toISOString() }].slice(-300));
    websocket.emit('spark:typing', { typing: false });
    try {
      const res = await websocket.emitWithAck<{ ok: boolean; message?: string }>('spark:chat', { text, client_id: id });
      if (!res?.ok) throw new Error(res?.message || 'Not delivered');
    } catch (err) {
      setLines((l) => l.map((x) => (x.id === id ? { ...x, text: `${x.text}  ⚠ ${err instanceof Error ? err.message : 'not delivered'}` } : x)));
    }
  };

  const onDraft = (v: string) => {
    setDraft(v);
    websocket.emit('spark:typing', { typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => websocket.emit('spark:typing', { typing: false }), 1500);
  };

  const sendInvite = async () => {
    if (!match.partner.username) {
      setInvite('This person has no username yet.');
      return;
    }
    setInvite('sending');
    const res = await sendConnectionInvite(match.partner.username);
    setInvite(res.ok ? 'sent' : res.message);
  };

  const leave = (reason: 'skip' | 'close') => {
    if (inThisCall) call.endCall();
    websocket.emit('spark:leave', { reason });
    setLines([]); // the temporary chat is gone
    if (reason === 'skip') onSkip();
    else onClose();
  };

  // Leaving the page also ends the match for the partner.
  useEffect(() => {
    return () => {
      websocket.emit('spark:leave', { reason: 'close' });
    };
  }, []);

  const online = presence.isOnline(partnerId);

  return (
    <div className={`spark-room ${chatOpen ? '' : 'spark-room--chat-closed'}`}>
      <header className="spark-room-head rd-card">
        <Avatar url={match.partner.avatar_url} name={match.partner.username} online={online} />
        <div className="spark-room-who">
          <strong>{partnerName}</strong>
          <span className="spark-room-meta">
            <span className={`spark-presence ${online ? 'spark-presence--on' : ''}`}>{online ? 'Online' : 'Offline'}</span>
            <span aria-hidden>·</span>
            {match.intent}
          </span>
        </div>
        <div className="spark-room-actions">
          <button type="button" className="rd-btn rd-btn--sm" onClick={sendInvite} disabled={invite === 'sending' || invite === 'sent'} title="Send a connection request" aria-label={invite === 'sent' ? 'Request sent' : 'Connect'}>
            <Icon name={invite === 'sent' ? 'check' : 'user-plus'} size={15} />
            <span className="rd-hide-mobile">{invite === 'sent' ? 'Request sent' : invite === 'sending' ? 'Sending…' : 'Connect'}</span>
          </button>
          <button type="button" className={`rd-btn rd-btn--sm rd-only-mobile ${chatOpen ? 'spark-chat-toggle--on' : ''}`} onClick={() => setChatOpen((o) => !o)} aria-label="Toggle chat" aria-pressed={chatOpen}>
            <Icon name="chat" size={16} />
          </button>
          <button type="button" className="rd-btn rd-btn--sm" onClick={() => leave('skip')} title="Skip to the next person" aria-label="Skip">
            <Icon name="skip" size={15} /> <span className="rd-hide-mobile">Skip</span>
          </button>
          <button type="button" className="rd-btn rd-btn--danger rd-btn--sm" onClick={() => leave('close')} title="End and go back" aria-label="End">
            <Icon name="close" size={15} /> <span className="rd-hide-mobile">End</span>
          </button>
        </div>
      </header>
      {typeof invite === 'string' && !['idle', 'sending', 'sent'].includes(invite) ? <p className="spark-error">{invite}</p> : null}

      <section className="spark-stage rd-card">
        {inThisCall && call.callState === 'active' ? (
          <>
            <CallMedia peer={match.partner} />
            <CallControls />
          </>
        ) : inThisCall && call.callState === 'ringing_outgoing' ? (
          <div className="spark-stage-idle">
            <div className="spark-stage-avatar spark-stage-avatar--ringing">
              <Avatar url={match.partner.avatar_url} name={match.partner.username} size="lg" />
            </div>
            <p className="spark-match-name">Connecting video…</p>
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={call.endCall}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="spark-stage-idle">
            <div className="spark-stage-avatar">
              <Avatar url={match.partner.avatar_url} name={match.partner.username} size="lg" online={online} />
            </div>
            <h2 className="spark-match-name">You matched with {partnerName}</h2>
            <div className="spark-match-tags">
              <span className="spark-match-on">
                Matched on <span className="rd-spectrum-text">{match.intent}</span>
              </span>
              <span className="rd-badge">
                <Icon name={match.mode === 'video' ? 'video' : 'chat'} size={12} /> {match.mode === 'video' ? 'Video' : 'Text first'}
              </span>
            </div>
            <p className="rd-muted rd-small">Both of you picked “{match.intent}”. Say hi in the chat.</p>
            <button
              type="button"
              className="rd-btn rd-btn--primary"
              disabled={call.callState !== 'idle' || !!ended}
              onClick={() => void call.startCall(match.conversation_id, 'video')}
            >
              <Icon name="video" size={15} /> Switch to video
            </button>
          </div>
        )}
        {ended ? (
          <div className="spark-ended" role="status">
            <p>{ended}</p>
            <div className="spark-ended-actions">
              <button type="button" className="rd-btn rd-btn--primary" onClick={() => leave('skip')}>
                Find someone new
              </button>
              <button type="button" className="rd-btn rd-btn--ghost" onClick={() => leave('close')}>
                Back
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="spark-chat rd-card" aria-label="Temporary chat">
        <div className="spark-chat-head">
          <strong>Chat</strong>
          <span className="spark-chat-sub">
            <Icon name="lock" size={12} /> Temporary · cleared when you skip or end
          </span>
        </div>
        <div className="spark-chat-list rd-scroll" ref={listRef}>
          {joined === 'pending' ? <p className="rd-small rd-muted spark-chat-note">Connecting…</p> : null}
          {joined === 'failed' ? (
            <p className="rd-small spark-error spark-chat-note">Chat could not connect. Check your connection and try again.</p>
          ) : null}
          {lines.length === 0 && joined === 'ok' ? <p className="rd-small rd-muted spark-chat-note">Messages here are not saved.</p> : null}
          {lines.map((l) => (
            <div key={l.id} className={`spark-bubble ${l.mine ? 'spark-bubble--me' : ''}`}>
              {l.text}
            </div>
          ))}
          {partnerTyping ? <div className="spark-bubble spark-typing" aria-label="Typing"><span /><span /><span /></div> : null}
        </div>
        <form
          className="spark-chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className="rd-input"
            value={draft}
            maxLength={1000}
            placeholder={joined === 'ok' ? 'Say something…' : 'Waiting for chat…'}
            disabled={joined !== 'ok' || !!ended}
            onChange={(e) => onDraft(e.target.value)}
            aria-label="Message"
          />
          <button type="submit" className="rd-icon-btn spark-send" disabled={!draft.trim() || joined !== 'ok' || !!ended} aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        </form>
      </aside>
    </div>
  );
}

export default function SparkPage() {
  const router = useRouter();
  const { stats, user } = useDashboard();
  const [phase, setPhase] = useState<Phase>('choose');
  const [mode, setMode] = useState<SparkMode>('text');
  const [intent, setIntent] = useState<SparkIntent>('Brainstorm');
  const [match, setMatch] = useState<Matched | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queuedRef = useRef(false);

  usePresenceHeartbeat(Boolean(user));

  const onMatched = useCallback((view: Matched) => {
    queuedRef.current = false;
    setMatch(view);
    setPhase('room');
  }, []);

  const start = useCallback(
    async (m: SparkMode = mode, i: SparkIntent = intent) => {
      setError(null);
      setBusy(true);
      try {
        const view = await joinSparkQueue(m, i);
        setElapsed(0);
        if (view.status === 'matched') {
          onMatched(view);
          return;
        }
        queuedRef.current = view.status === 'waiting';
        setPhase('waiting');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not join the match queue');
        setPhase('choose');
      } finally {
        setBusy(false);
      }
    },
    [mode, intent, onMatched]
  );

  // Resume a search that was running before a reload (a stale old match is not reopened).
  useEffect(() => {
    getSparkStatus()
      .then((v) => {
        if (v.status === 'waiting') {
          setMode(v.mode);
          setIntent(v.intent);
          setElapsed(v.waited_seconds);
          queuedRef.current = true;
          setPhase('waiting');
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (phase !== 'waiting') return;
    let stop = false;
    const poll = setInterval(async () => {
      try {
        const v = await getSparkStatus();
        if (stop) return;
        if (v.status === 'matched') onMatched(v);
        else if (v.status === 'idle') {
          queuedRef.current = false;
          setError('You left the queue. Start again when you are ready.');
          setPhase('choose');
        }
      } catch {
        // transient: keep polling
      }
    }, POLL_MS);
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [phase, onMatched]);

  useEffect(
    () => () => {
      if (queuedRef.current) leaveSparkQueue().catch(() => undefined);
    },
    []
  );

  const cancel = async () => {
    setBusy(true);
    try {
      await leaveSparkQueue();
    } catch {
      // the server drops stale entries anyway
    } finally {
      queuedRef.current = false;
      setBusy(false);
      setPhase('choose');
    }
  };

  return (
    <div className="rd-page spark-page">
      {phase === 'choose' ? (
        <ChooseStep
          mode={mode}
          setMode={setMode}
          intent={intent}
          setIntent={setIntent}
          onStart={() => void start()}
          busy={busy}
          error={error}
          lookingNow={stats?.lookingForMatch ?? null}
        />
      ) : null}
      {phase === 'waiting' ? <WaitingStep mode={mode} intent={intent} elapsed={elapsed} onCancel={cancel} busy={busy} /> : null}
      {phase === 'room' && match ? (
        <MatchRoom
          key={match.partner.id + match.conversation_id}
          match={match}
          onSkip={() => {
            setMatch(null);
            void start(match.mode, match.intent);
          }}
          onClose={() => {
            setMatch(null);
            setPhase('choose');
          }}
        />
      ) : null}
      {phase === 'choose' ? (
        <button type="button" className="spark-back rd-btn rd-btn--ghost rd-btn--sm" onClick={() => router.push('/dashboard')}>
          <Icon name="back" size={16} /> Home
        </button>
      ) : null}
    </div>
  );
}
