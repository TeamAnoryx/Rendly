'use client';

import React, { useRef, useState } from 'react';
import websocket from '@/services/websocket';
import { emitPointsChanged, newIdempotencyKey, notifyPointsPeers, tipHuddleHost } from '@/services/pointsApi';
import { useNotifications } from '@/context/NotificationsContext';
import { Icon } from '@/components/shell/Icon';

const TIP_MIN = 1;
const TIP_MAX = 1000;
const QUICK_AMOUNTS = [10, 25, 50, 100];

/** Lets a participant send Rendly Tokens to the huddle host from their own balance. */
export default function TipHostCard({
  huddleId,
  room,
  hostId,
  hostName,
}: {
  huddleId: string;
  room: string;
  hostId: string;
  hostName: string;
}) {
  const { pushToast } = useNotifications();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(25);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Key of the last unconfirmed attempt, reused on retry so a send can never happen twice. */
  const attemptRef = useRef<{ sig: string; key: string } | null>(null);

  const send = async () => {
    if (sending) return;
    const amt = Math.max(TIP_MIN, Math.min(TIP_MAX, Math.round(amount) || TIP_MIN));
    const sig = `${amt}|${note.trim()}`;
    if (!attemptRef.current || attemptRef.current.sig !== sig) {
      attemptRef.current = { sig, key: newIdempotencyKey() };
    }
    setSending(true);
    setError(null);
    try {
      await tipHuddleHost(huddleId, { amount: amt, note: note.trim() || null, idempotency_key: attemptRef.current.key });
      attemptRef.current = null;
      emitPointsChanged();
      notifyPointsPeers([hostId]);
      websocket.emit('huddle:tokens', { huddle_id: huddleId, room, to: hostId, amount: amt });
      pushToast({ icon: 'coin', title: `Sent ${amt} Rendly Tokens to ${hostName}` });
      setOpen(false);
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send Rendly Tokens');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="rd-btn rd-btn--sm hr-tip-open" onClick={() => setOpen(true)}>
        <Icon name="coin" size={14} /> Send tokens to {hostName}
      </button>
    );
  }

  return (
    <div className="hr-tip" role="group" aria-label={`Send Rendly Tokens to ${hostName}`}>
      <div className="hr-tip-quick">
        {QUICK_AMOUNTS.map((n) => (
          <button key={n} type="button" className={`rd-chip ${amount === n ? 'rd-chip--on' : ''}`} onClick={() => setAmount(n)}>
            {n}
          </button>
        ))}
        <input
          type="number"
          inputMode="numeric"
          min={TIP_MIN}
          max={TIP_MAX}
          className="rd-input rd-mono hr-tip-amount"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Amount"
        />
      </div>
      <input
        className="rd-input"
        maxLength={140}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Say thanks (optional)"
      />
      {error ? <p className="hr-err">{error}</p> : null}
      <div className="hr-tip-actions">
        <button type="button" className="rd-btn rd-btn--sm" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </button>
        <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={send} disabled={sending}>
          {sending ? 'Sending…' : `Send ${Math.max(TIP_MIN, Math.round(amount) || TIP_MIN)}`}
        </button>
      </div>
    </div>
  );
}
