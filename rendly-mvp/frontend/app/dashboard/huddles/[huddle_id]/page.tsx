'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  cancelHuddle,
  deleteHuddle,
  getHuddle,
  HUDDLE_MODE_LABELS,
  inviteToHuddle,
  joinHuddle,
  leaveHuddle,
  setHuddleDisplayName,
  uploadHuddleThumbnail,
  videoDurationSeconds,
  type HuddleDetail,
} from '@/services/huddlesApi';
import { getConnections, type Connection } from '@/services/connectionsApi';
import { useCurrentUser } from '@/context/CurrentUserContext';
import HuddleRoom from '@/components/huddles/HuddleRoom';
import { HuddlePoster } from '@/components/huddles/HuddleList';
import { Icon } from '@/components/shell/Icon';
import '../huddles.css';

const WAITING_POLL_MS = 4000;
const PROMO_MAX_SECONDS = 15;

function whenLabel(h: HuddleDetail): string {
  if (h.cancelled_at) return 'Cancelled';
  if (h.started_at && !h.ended_at) return 'Live now';
  if (h.ended_at) return 'Ended';
  if (h.scheduled_at) return new Date(h.scheduled_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return 'Starts when people join';
}

/** Camera preview for the lobby. Asks for the camera only after the user opts in. */
function Preview() {
  const ref = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  const start = async () => {
    setErr(null);
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    } catch {
      setErr('Camera blocked or unavailable. You can still join and listen.');
    }
  };
  return (
    <div className="hl-preview">
      <video ref={ref} autoPlay playsInline muted className="hr-mirror" style={{ opacity: stream ? 1 : 0 }} />
      {!stream ? (
        <div className="hl-preview-off">
          <Icon name="video-off" size={28} />
          <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={start}>
            Check my camera
          </button>
          {err ? <p className="rd-small rd-muted">{err}</p> : null}
        </div>
      ) : (
        <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm hl-preview-stop" onClick={() => setStream(null)}>
          Turn off preview
        </button>
      )}
    </div>
  );
}

function HostTools({ huddle, onChanged, onGone }: { huddle: HuddleDetail; onChanged: () => Promise<void>; onGone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run('thumb', async () => {
      if (file.type.startsWith('video/')) {
        const secs = await videoDurationSeconds(file);
        if (secs > PROMO_MAX_SECONDS + 0.5) throw new Error(`Promo videos can be at most ${PROMO_MAX_SECONDS} seconds (this one is ${Math.round(secs)} s).`);
      }
      await uploadHuddleThumbnail(huddle.id, file);
      await onChanged();
      setMsg('Thumbnail updated.');
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section className="rd-card hl-host">
      <h3 className="rd-h2">
        <Icon name="settings" size={16} /> Host tools
      </h3>
      <div className="hl-host-row">
        <button type="button" className="rd-btn rd-btn--sm" disabled={busy === 'thumb'} onClick={() => fileRef.current?.click()}>
          {busy === 'thumb' ? <span className="rd-spinner" /> : <Icon name="upload" size={15} />} Poster or 15 s promo
        </button>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          type="button"
          className="rd-btn rd-btn--sm"
          onClick={() => {
            if (connections) setConnections(null);
            else getConnections().then(setConnections).catch(() => setConnections([]));
          }}
        >
          <Icon name="user-plus" size={15} /> Invite
        </button>
        {!huddle.cancelled_at ? (
          <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => setConfirm('cancel')}>
            Cancel huddle
          </button>
        ) : null}
        <button type="button" className="rd-btn rd-btn--danger rd-btn--sm" onClick={() => setConfirm('delete')}>
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
      {confirm ? (
        <div className="hl-confirm" role="alertdialog">
          <p>{confirm === 'cancel' ? 'Cancel this huddle? Invitees are told it was cancelled.' : 'Delete this huddle permanently? This cannot be undone.'}</p>
          <div className="hl-host-row">
            <button
              type="button"
              className="rd-btn rd-btn--danger rd-btn--sm"
              disabled={!!busy}
              onClick={() =>
                run(confirm, async () => {
                  if (confirm === 'cancel') {
                    await cancelHuddle(huddle.id);
                    setConfirm(null);
                    await onChanged();
                  } else {
                    await deleteHuddle(huddle.id);
                    onGone();
                  }
                })
              }
            >
              {busy ? <span className="rd-spinner" /> : null} Yes, {confirm}
            </button>
            <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => setConfirm(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {connections ? (
        <div className="hl-invite">
          {connections.length === 0 ? (
            <p className="rd-small rd-muted">No connections to invite yet.</p>
          ) : (
            <>
              <div className="hl-invite-list rd-scroll">
                {connections.map((c) => (
                  <label key={c.id} className="hl-invite-item">
                    <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
                    @{c.username ?? 'user'}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="rd-btn rd-btn--primary rd-btn--sm"
                disabled={picked.length === 0 || busy === 'invite'}
                onClick={() =>
                  run('invite', async () => {
                    const n = await inviteToHuddle(huddle.id, picked);
                    setPicked([]);
                    setMsg(`Invited ${n} ${n === 1 ? 'person' : 'people'}.`);
                  })
                }
              >
                Send invites
              </button>
            </>
          )}
        </div>
      ) : null}
      {msg ? <p className="rd-small hl-ok">{msg}</p> : null}
      {err ? <p className="rd-small hl-err">{err}</p> : null}
    </section>
  );
}

export default function HuddleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const huddleId = typeof params?.huddle_id === 'string' ? params.huddle_id : '';
  const inviteCode = useSearchParams()?.get('code') ?? null;
  const { user } = useCurrentUser();
  const [huddle, setHuddle] = useState<HuddleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!huddleId) return;
    setHuddle(await getHuddle(huddleId, inviteCode));
  }, [huddleId, inviteCode]);

  useEffect(() => {
    if (!huddleId) {
      setLoading(false);
      setError('This huddle link is not valid.');
      return;
    }
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the huddle'))
      .finally(() => setLoading(false));
  }, [huddleId, reload]);

  useEffect(() => {
    if (user?.username && !displayName) setDisplayName(user.username);
  }, [user?.username, displayName]);

  // The waiting room checks in until the host admits you, then you go straight in.
  const waiting = huddle?.is_waiting === true;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      reload().catch(() => undefined);
    }, WAITING_POLL_MS);
    return () => clearInterval(id);
  }, [waiting, reload]);
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (waiting) wasWaiting.current = true;
    else if (wasWaiting.current && huddle?.is_participant) {
      wasWaiting.current = false;
      setInRoom(true);
    }
  }, [waiting, huddle?.is_participant]);

  const join = async () => {
    if (!huddle) return;
    setJoining(true);
    setError(null);
    const name = displayName.trim().replace(/\s+/g, ' ').slice(0, 40);
    try {
      if (huddle.is_participant) {
        if (name) await setHuddleDisplayName(huddle.id, name).catch(() => undefined);
      } else {
        const res = await joinHuddle(huddle.id, inviteCode, name || null);
        if (res.status === 'waiting') {
          await reload();
          return;
        }
      }
      await reload();
      setInRoom(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
    } finally {
      setJoining(false);
    }
  };

  const leave = async () => {
    if (!huddle) return;
    setLeaveError(null);
    try {
      await leaveHuddle(huddle.id);
      setInRoom(false);
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not leave';
      setLeaveError(msg);
    }
  };

  const endForAll = async () => {
    if (!huddle || !window.confirm('End this huddle for everyone?')) return;
    try {
      await cancelHuddle(huddle.id);
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : 'Could not end the huddle');
      return;
    }
    router.push('/dashboard/huddles');
  };

  if (loading) {
    return (
      <div className="rd-page">
        <div className="rd-loader-screen">
          <span className="rd-spinner rd-spinner--lg" />
          <p className="rd-muted">Loading huddle…</p>
        </div>
      </div>
    );
  }

  if (!huddle) {
    return (
      <div className="rd-page">
        <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm hl-back" onClick={() => router.push('/dashboard/huddles')}>
          <Icon name="back" size={16} /> Huddles
        </button>
        <div className="rd-loader-screen">
          <Icon name="huddle" size={36} />
          <p>{error ?? 'Huddle not found.'}</p>
        </div>
      </div>
    );
  }

  if (inRoom && huddle.is_participant) {
    const canLeave = huddle.your_role === 'host' || huddle.your_role === 'co_host' || huddle.allow_self_exit !== false;
    return (
      <div className="rd-page hl-room-page">
        {leaveError ? <p className="hl-err hl-room-err">{leaveError}</p> : null}
        <HuddleRoom huddle={huddle} onLeave={() => void leave()} onEnd={huddle.your_role === 'host' ? () => void endForAll() : undefined} canLeave={canLeave} />
      </div>
    );
  }

  const isOwner = huddle.is_owner || huddle.your_role === 'host';
  const cancelled = !!huddle.cancelled_at;
  const full = huddle.participants_count >= huddle.max_participants && !huddle.is_participant;

  return (
    <div className="rd-page hl">
      <button type="button" className="rd-btn rd-btn--ghost rd-btn--sm hl-back" onClick={() => router.push('/dashboard/huddles')}>
        <Icon name="back" size={16} /> Huddles
      </button>
      <div className="hl-grid">
        <section className="hl-info rd-scroll">
          <HuddlePoster huddle={huddle} large />
          <div className="hl-meta">
            <span className={`rd-badge ${huddle.started_at && !huddle.ended_at && !cancelled ? 'rd-badge--live' : ''}`}>{whenLabel(huddle)}</span>
            {huddle.mode ? <span className="rd-chip">{HUDDLE_MODE_LABELS[huddle.mode]}</span> : null}
            <span className="rd-chip">
              {huddle.type === 'private' ? <Icon name="lock" size={12} /> : <Icon name="globe" size={12} />} {huddle.type}
            </span>
            {huddle.rewards_enabled !== false ? (
              <span className="rd-chip">
                <Icon name="trophy" size={12} /> Rewards
              </span>
            ) : null}
          </div>
          <h1 className="rd-h1">{huddle.title}</h1>
          {huddle.description ? <p className="hl-desc">{huddle.description}</p> : null}
          {huddle.intents && huddle.intents.length ? (
            <p className="hl-tags">
              {huddle.intents.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </p>
          ) : null}
          <p className="rd-muted rd-small">
            {huddle.participants_count}/{huddle.max_participants} in the huddle
            {huddle.duration_minutes ? ` · ${huddle.duration_minutes} min` : ''}
            {huddle.allow_self_exit === false ? ' · host controls entry and exit' : ''}
          </p>
          {isOwner ? <HostTools huddle={huddle} onChanged={reload} onGone={() => router.push('/dashboard/huddles')} /> : null}
        </section>

        <section className="rd-card hl-join">
          {cancelled ? (
            <div className="hl-state">
              <Icon name="calendar" size={30} />
              <h2 className="rd-h2">This huddle was cancelled</h2>
              <p className="rd-muted rd-small">The host called it off.</p>
            </div>
          ) : huddle.is_waiting ? (
            <div className="hl-state">
              <span className="rd-spinner rd-spinner--lg" />
              <h2 className="rd-h2">Waiting for the host</h2>
              <p className="rd-muted rd-small">You will be let in automatically. Keep this page open.</p>
            </div>
          ) : (
            <>
              <Preview />
              <label className="rd-label" htmlFor="hl-name">
                Your name in this huddle
              </label>
              <input
                id="hl-name"
                className="rd-input"
                value={displayName}
                maxLength={40}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others will see you"
              />
              {error ? <p className="rd-small hl-err">{error}</p> : null}
              <button type="button" className="rd-btn rd-btn--primary rd-btn--lg hl-join-btn" onClick={() => void join()} disabled={joining || full || !displayName.trim()}>
                {joining ? <span className="rd-spinner" /> : <Icon name="door" size={18} />}
                {full ? 'Huddle is full' : huddle.is_participant ? 'Enter the room' : huddle.waiting_room && !isOwner ? 'Ask to join' : 'Join now'}
              </button>
              <p className="rd-small rd-muted">You join with your mic and camera off.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
