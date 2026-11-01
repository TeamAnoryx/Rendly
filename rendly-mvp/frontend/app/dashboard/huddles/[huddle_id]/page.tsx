'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  admitHuddleMember,
  getHuddle,
  HUDDLE_MODE_LABELS,
  inviteToHuddle,
  joinHuddle,
  leaveHuddle,
  listHuddleMembers,
  removeHuddleMember,
  setHuddleWaitingRoom,
  updateHuddleMember,
  uploadHuddleMedia,
  type HuddleDetail,
  type HuddleMember,
} from '@/services/huddlesApi';
import { getConnections, type Connection } from '@/services/connectionsApi';
import HuddleRoom from '@/components/huddles/HuddleRoom';

/** How often a waiting person checks whether the host has let them in. */
const WAITING_POLL_MS = 5000;

export default function HuddleDetailPage() {
  const params = useParams();
  const huddleId = typeof params?.huddle_id === 'string' ? params.huddle_id : '';
  const inviteCode = useSearchParams()?.get('code') ?? null;
  const [huddle, setHuddle] = useState<HuddleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!huddleId) return;
    const fresh = await getHuddle(huddleId, inviteCode);
    setHuddle(fresh);
  }, [huddleId, inviteCode]);

  useEffect(() => {
    if (!huddleId) {
      setLoading(false);
      setError('Invalid huddle');
      return;
    }
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [huddleId, reload]);

  // Waiting people are checked every few seconds until the host lets them in.
  const waiting = huddle?.is_waiting === true;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      reload().catch(() => {});
    }, WAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const run = useCallback(
    async (action: () => Promise<void>, failure: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : failure);
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const handleJoin = useCallback(() => {
    run(async () => {
      const result = await joinHuddle(huddleId, inviteCode);
      setMessage(result.status === 'waiting' ? 'Waiting for the host to let you in.' : null);
    }, 'Failed to join');
  }, [huddleId, inviteCode, run]);

  const handleLeave = useCallback(() => {
    run(async () => {
      await leaveHuddle(huddleId);
      setMessage(null);
    }, 'Failed to leave');
  }, [huddleId, run]);

  if (loading) return <div className="dash-huddles-root"><div className="dash-huddles-loading">Loading…</div></div>;
  if (error && !huddle) return <div className="dash-huddles-root"><div className="dash-huddles-error">{error}</div><Link href="/dashboard/huddles">Back to Huddles</Link></div>;
  if (!huddle) return null;

  const isHost = huddle.your_role === 'host';
  const canManage = huddle.your_role === 'host' || huddle.your_role === 'co_host';

  return (
    <div className="dash-huddles-root">
      <div className="dash-huddles-detail">
        <Link href="/dashboard/huddles" className="dash-huddles-back">← Back to Huddles</Link>
        <h1 className="dash-huddles-page-title">{huddle.title}</h1>
        {huddle.description && <p className="dash-huddles-detail-desc">{huddle.description}</p>}
        <p className="dash-huddles-detail-meta">
          {huddle.participants_count} / {huddle.max_participants} participants · {huddle.type}
          {huddle.mode && huddle.mode !== 'open' ? ` · ${HUDDLE_MODE_LABELS[huddle.mode]}` : ''}
          {huddle.waiting_room ? ' · waiting room' : ''}
        </p>
        {huddle.intents && huddle.intents.length > 0 && (
          <p className="dash-huddles-card-type">{huddle.intents.map((t) => `#${t}`).join('  ')}</p>
        )}

        {huddle.media_url && huddle.media_type === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={huddle.media_url} alt="" className="dash-huddles-media" />
        )}
        {huddle.media_url && huddle.media_type === 'video' && (
          <video src={huddle.media_url} controls className="dash-huddles-media" />
        )}
        {huddle.media_url && huddle.media_type === 'audio' && (
          <audio src={huddle.media_url} controls className="dash-huddles-media" />
        )}

        {message && <p className="dash-huddles-create-hint" role="status">{message}</p>}
        {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}

        {huddle.is_participant ? (
          <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={handleLeave} disabled={busy}>
            {busy ? 'Leaving…' : 'Leave huddle'}
          </button>
        ) : huddle.is_waiting ? (
          <p className="dash-huddles-create-hint">You are in the waiting room. This page updates when the host lets you in.</p>
        ) : (
          <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--primary" onClick={handleJoin} disabled={busy}>
            {busy ? 'Joining…' : 'Join huddle'}
          </button>
        )}

        {huddle.is_participant && huddle.your_role && (
          <HuddleRoom
            huddleId={huddleId}
            role={huddle.your_role}
            canSpeak={huddle.your_permissions?.can_speak ?? true}
          />
        )}

        {canManage && (
          <HostPanel huddleId={huddleId} isHost={isHost} waitingRoom={huddle.waiting_room ?? false} onChanged={reload} />
        )}

        {isHost && (
          <MediaUpload huddleId={huddleId} onUploaded={reload} />
        )}

        {canManage && <InvitePanel huddleId={huddleId} onInvited={reload} />}
      </div>
    </div>
  );
}

/** Host and co-host controls: waiting room, admitting, roles, permissions and removal. */
function HostPanel({
  huddleId,
  isHost,
  waitingRoom,
  onChanged,
}: {
  huddleId: string;
  isHost: boolean;
  waitingRoom: boolean;
  onChanged: () => Promise<void>;
}) {
  const [members, setMembers] = useState<HuddleMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await listHuddleMembers(huddleId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    }
  }, [huddleId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, WAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = useCallback(
    async (userId: string, action: () => Promise<void>) => {
      setBusyUser(userId);
      setError(null);
      try {
        await action();
        await load();
        await onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusyUser(null);
      }
    },
    [load, onChanged]
  );

  const waitingList = members.filter((m) => !m.admitted);
  const inRoom = members.filter((m) => m.admitted);

  return (
    <section className="dash-huddles-card-section" aria-label="Host controls">
      <h2 className="dash-huddles-section-title">Host controls</h2>

      {isHost && (
        <label className="dash-huddles-create-label">
          <input
            type="checkbox"
            checked={waitingRoom}
            onChange={(e) => act('__room__', () => setHuddleWaitingRoom(huddleId, e.target.checked))}
          />{' '}
          Waiting room
        </label>
      )}

      <h3 className="dash-huddles-create-card-title">Waiting ({waitingList.length})</h3>
      {waitingList.length === 0 ? (
        <p className="dash-huddles-create-hint">Nobody is waiting.</p>
      ) : (
        <ul className="dash-huddles-create-invitees">
          {waitingList.map((m) => (
            <li key={m.user_id}>
              {m.username ?? 'User'}{' '}
              <button type="button" className="dash-huddles-create-opt" disabled={busyUser === m.user_id} onClick={() => act(m.user_id, () => admitHuddleMember(huddleId, m.user_id))}>
                Admit
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="dash-huddles-create-card-title">In the room ({inRoom.length})</h3>
      <ul className="dash-huddles-create-invitees">
        {inRoom.map((m) => {
          const isHostRow = m.role === 'host';
          const disabled = busyUser === m.user_id;
          return (
            <li key={m.user_id}>
              <strong>{m.username ?? 'User'}</strong>{' '}
              <span className="dash-huddles-create-hint">
                {m.role === 'host' ? 'host' : m.role === 'co_host' ? 'co-host' : 'participant'}
              </span>
              {!isHostRow && (
                <>
                  {' '}
                  <label>
                    <input type="checkbox" checked={m.can_speak} disabled={disabled}
                      onChange={(e) => act(m.user_id, () => updateHuddleMember(huddleId, m.user_id, { can_speak: e.target.checked }))} />{' '}
                    speak
                  </label>{' '}
                  <label>
                    <input type="checkbox" checked={m.can_share_screen} disabled={disabled}
                      onChange={(e) => act(m.user_id, () => updateHuddleMember(huddleId, m.user_id, { can_share_screen: e.target.checked }))} />{' '}
                    share screen
                  </label>{' '}
                  <label>
                    <input type="checkbox" checked={m.is_muted} disabled={disabled}
                      onChange={(e) => act(m.user_id, () => updateHuddleMember(huddleId, m.user_id, { is_muted: e.target.checked }))} />{' '}
                    muted
                  </label>{' '}
                  {isHost && (
                    <button type="button" className="dash-huddles-create-opt" disabled={disabled}
                      onClick={() => act(m.user_id, () => updateHuddleMember(huddleId, m.user_id, { role: m.role === 'co_host' ? 'participant' : 'co_host' }))}>
                      {m.role === 'co_host' ? 'Remove co-host' : 'Make co-host'}
                    </button>
                  )}{' '}
                  <button type="button" className="dash-huddles-create-opt" disabled={disabled}
                    onClick={() => act(m.user_id, () => removeHuddleMember(huddleId, m.user_id))}>
                    Remove
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}
    </section>
  );
}

/** Upload promotion media (image, video or audio). Host only. */
function MediaUpload({ huddleId, onUploaded }: { huddleId: string; onUploaded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        await uploadHuddleMedia(huddleId, file);
        await onUploaded();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [huddleId, onUploaded]
  );

  return (
    <section className="dash-huddles-card-section">
      <h2 className="dash-huddles-section-title">Promotion</h2>
      <p className="dash-huddles-create-hint">Add an image, video or audio clip to promote this huddle (25 MB max).</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/ogg"
        disabled={busy}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {busy && <p className="dash-huddles-create-hint">Uploading…</p>}
      {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}
    </section>
  );
}

/** Invite connected users to a huddle. */
function InvitePanel({ huddleId, onInvited }: { huddleId: string; onInvited: () => Promise<void> }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConnections()
      .then(setConnections)
      .catch(() => setConnections([]));
  }, []);

  const send = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      const count = await inviteToHuddle(huddleId, selected);
      setStatus(`Invited ${count} ${count === 1 ? 'person' : 'people'}.`);
      setSelected([]);
      await onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invites');
    }
  }, [huddleId, selected, onInvited]);

  return (
    <section className="dash-huddles-card-section">
      <h2 className="dash-huddles-section-title">Invite connections</h2>
      {connections.length === 0 ? (
        <p className="dash-huddles-create-hint">You have no connections to invite yet.</p>
      ) : (
        <>
          <ul className="dash-huddles-create-invitees">
            {connections.map((c) => (
              <li key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={() => setSelected((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  />{' '}
                  {c.username ?? 'User'}
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="dash-huddles-create-btn dash-huddles-create-btn--secondary" onClick={send} disabled={selected.length === 0}>
            Send invites
          </button>
        </>
      )}
      {status && <p className="dash-huddles-create-hint" role="status">{status}</p>}
      {error && <p className="dash-huddles-create-error" role="alert">{error}</p>}
    </section>
  );
}
