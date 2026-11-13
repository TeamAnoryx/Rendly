'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import { TokenCoin, TokenAmount } from '@/components/brand/TokenCoin';
import { getMyPoints, transferTokens, emitPointsChanged, newIdempotencyKey } from '@/services/pointsApi';
import { chat as chatApi, type ChatMessage } from '@/services/chat';
import { useNotifications } from '@/context/NotificationsContext';

export const NOTE_MAX_LENGTH = 140;
const QUICK_AMOUNTS = [10, 50, 100] as const;

export type SendTokensRecipient = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export interface SendTokensSheetProps {
  open: boolean;
  onClose: () => void;
  /** Whisper conversation id (`whisper_<a>_<b>`); passed to both the transfer and the message. */
  conversationId: string;
  recipient: SendTokensRecipient;
  /** Called once the token_transfer message is stored so the thread can show it immediately. */
  onSent?: (message: ChatMessage) => void;
}

type Phase = 'idle' | 'sending' | 'posting' | 'needs_retry' | 'done';

/** Parses the amount field: integer ≥ 1 or null when invalid. */
export function parseTokenAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isInsufficient(message: string): boolean {
  return /not enough|insufficient/i.test(message);
}

/**
 * Bottom-sheet style dialog for sending Rendly Tokens to a whisper partner.
 * Flow: transferTokens (auth-service) → chatApi.sendMessage token_transfer (chat-service) → emitPointsChanged.
 * If the message post fails, the transfer_id is kept and only the message is retried.
 */
export default function SendTokensSheet({ open, onClose, conversationId, recipient, onSent }: SendTokensSheetProps) {
  const { pushToast } = useNotifications();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  /** Transfer that moved tokens but whose message has not been posted yet. */
  const pendingTransferRef = useRef<{ transferId: string; amount: number } | null>(null);
  /** Idempotency-Key of the current send attempt; reused when step 1 is retried with the same amount and note. */
  const attemptRef = useRef<{ key: string; amount: number; note: string } | null>(null);
  const busyRef = useRef(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const refreshBalance = useCallback(async () => {
    try {
      const summary = await getMyPoints();
      setBalance(summary.total);
      setBalanceError(null);
    } catch (err: unknown) {
      setBalanceError(errorMessage(err, 'Could not load your balance'));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setAmountRaw('');
    setNote('');
    setError(null);
    setPhase('idle');
    pendingTransferRef.current = null;
    attemptRef.current = null;
    busyRef.current = false;
    setBalance(null);
    void refreshBalance();
    const t = setTimeout(() => amountInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, refreshBalance]);

  const amount = useMemo(() => parseTokenAmount(amountRaw), [amountRaw]);
  const amountTooHigh = amount !== null && balance !== null && amount > balance;
  const amountInvalid = amountRaw.trim() !== '' && amount === null;
  const noteTooLong = note.length > NOTE_MAX_LENGTH;
  const busy = phase === 'sending' || phase === 'posting';
  const canSubmit = !busy && phase !== 'done' && amount !== null && !amountTooHigh && !noteTooLong && balance !== null;

  const postMessage = useCallback(
    async (transferId: string, amt: number) => {
      setPhase('posting');
      try {
        const serverMsg = await chatApi.sendMessage(conversationId, String(amt), {
          content_type: 'token_transfer',
          transfer_id: transferId,
        });
        if (!serverMsg) throw new Error('Message was not posted');
        pendingTransferRef.current = null;
        setPhase('done');
        setSpinKey((k) => k + 1);
        emitPointsChanged();
        onSent?.(serverMsg);
        pushToast({ icon: '◉', title: `Sent ${amt.toLocaleString('en-IN')} Rendly Tokens`, body: `to ${recipient.name}` });
        setTimeout(onClose, 650);
      } catch (err: unknown) {
        pendingTransferRef.current = { transferId, amount: amt };
        setPhase('needs_retry');
        setError(errorMessage(err, 'Tokens sent, message not posted'));
        emitPointsChanged();
      } finally {
        busyRef.current = false;
      }
    },
    [conversationId, onClose, onSent, pushToast, recipient.name]
  );

  const handleSend = useCallback(async () => {
    if (busyRef.current || !canSubmit || amount === null) return;
    busyRef.current = true;
    setError(null);
    setPhase('sending');
    let transferId: string;
    const trimmedNote = note.trim();
    const prior = attemptRef.current;
    const attempt =
      prior && prior.amount === amount && prior.note === trimmedNote
        ? prior
        : { key: newIdempotencyKey(), amount, note: trimmedNote };
    attemptRef.current = attempt;
    try {
      const result = await transferTokens({
        to_user_id: recipient.id,
        amount,
        note: trimmedNote || null,
        conversation_id: conversationId,
        idempotency_key: attempt.key,
      });
      transferId = result.transfer_id;
      attemptRef.current = null;
      setBalance(result.balance);
      if (!transferId) throw new Error('Transfer did not return an id');
    } catch (err: unknown) {
      const msg = errorMessage(err, 'Could not send Rendly Tokens');
      setError(isInsufficient(msg) ? 'Not enough Rendly Tokens for this amount.' : msg);
      setPhase('idle');
      busyRef.current = false;
      if (isInsufficient(msg)) void refreshBalance();
      return;
    }
    await postMessage(transferId, amount);
  }, [amount, canSubmit, conversationId, note, postMessage, recipient.id, refreshBalance]);

  const handleRetry = useCallback(async () => {
    const pending = pendingTransferRef.current;
    if (busyRef.current || !pending) return;
    busyRef.current = true;
    setError(null);
    await postMessage(pending.transferId, pending.amount);
  }, [postMessage]);

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const setQuick = (value: number) => {
    if (busy || phase === 'needs_retry') return;
    setAmountRaw(String(value));
    setError(null);
  };

  const initials = recipient.name.slice(0, 2).toUpperCase();
  const needsRetry = phase === 'needs_retry';

  return (
    <Modal open={open} onClose={handleClose} title={null}>
      <div className="stk" data-phase={phase}>
        <div className="stk-head">
          <div className="stk-recipient">
            {recipient.avatarUrl ? (
              <img src={recipient.avatarUrl} alt="" className="stk-avatar" referrerPolicy="no-referrer" />
            ) : (
              <span className="stk-avatar stk-avatar--initials" aria-hidden>{initials}</span>
            )}
            <div className="stk-recipient-text">
              <div className="stk-title">Send Rendly Tokens</div>
              <div className="stk-to">to {recipient.name}</div>
            </div>
          </div>
          <div className="stk-balance" aria-live="polite">
            <span className="stk-balance-label">Balance</span>
            {balance === null ? (
              <span className="stk-balance-value stk-balance-value--loading">{balanceError ? '—' : '…'}</span>
            ) : (
              <TokenAmount amount={balance} size={14} className="stk-balance-value" />
            )}
          </div>
        </div>

        {needsRetry ? (
          <div className="stk-retry" role="alert">
            <TokenCoin size={28} />
            <div className="stk-retry-text">
              <div className="stk-retry-title">Tokens sent, message not posted</div>
              <div className="stk-retry-body">
                {pendingTransferRef.current ? `${pendingTransferRef.current.amount.toLocaleString('en-IN')} Rendly Tokens reached ${recipient.name}, but the chat bubble could not be posted.` : ''}
                {error ? ` ${error}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <>
            <label className="rd-label stk-label" htmlFor="stk-amount">Amount</label>
            <div className="stk-amount-row">
              <TokenCoin size={22} />
              <input
                id="stk-amount"
                ref={amountInputRef}
                className={`rd-input stk-amount-input ${amountInvalid || amountTooHigh ? 'stk-amount-input--invalid' : ''}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={amountRaw}
                disabled={busy || phase === 'done'}
                onChange={(e) => {
                  setAmountRaw(e.target.value.replace(/[^\d]/g, ''));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                aria-invalid={amountInvalid || amountTooHigh || undefined}
                aria-describedby="stk-amount-hint"
              />
            </div>
            <div className="stk-chips" role="group" aria-label="Quick amounts">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`rd-chip ${amount === q ? 'rd-chip--on' : ''}`}
                  disabled={busy || balance === null || q > balance}
                  onClick={() => setQuick(q)}
                >
                  {q}
                </button>
              ))}
              <button
                type="button"
                className={`rd-chip ${balance !== null && balance > 0 && amount === balance ? 'rd-chip--on' : ''}`}
                disabled={busy || balance === null || balance < 1}
                onClick={() => balance !== null && setQuick(balance)}
              >
                Max
              </button>
            </div>
            <div id="stk-amount-hint" className="stk-hint">
              {amountTooHigh
                ? 'That is more than your balance.'
                : amountInvalid
                  ? 'Enter a whole number of at least 1.'
                  : balance !== null
                    ? `Min 1 · Max ${balance.toLocaleString('en-IN')}`
                    : balanceError ?? 'Loading balance…'}
            </div>

            <label className="rd-label stk-label" htmlFor="stk-note">
              Note <span className="stk-optional">(optional)</span>
            </label>
            <textarea
              id="stk-note"
              className={`rd-input stk-note ${noteTooLong ? 'stk-amount-input--invalid' : ''}`}
              rows={2}
              maxLength={NOTE_MAX_LENGTH + 20}
              placeholder="Say why"
              value={note}
              disabled={busy || phase === 'done'}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="stk-note-count"
            />
            <div id="stk-note-count" className={`stk-counter ${noteTooLong ? 'stk-counter--over' : ''}`}>
              {note.length}/{NOTE_MAX_LENGTH}
            </div>
          </>
        )}

        {error && !needsRetry ? (
          <div className="stk-error" role="alert">{error}</div>
        ) : null}

        <div className="stk-actions">
          <button type="button" className="rd-btn rd-btn--ghost" onClick={handleClose} disabled={busy}>
            {needsRetry ? 'Close' : 'Cancel'}
          </button>
          {needsRetry ? (
            <button type="button" className="rd-btn rd-btn--primary stk-send" onClick={() => void handleRetry()} disabled={busy}>
              {busy ? 'Posting…' : 'Retry'}
            </button>
          ) : (
            <button
              type="button"
              className={`rd-btn rd-btn--primary stk-send ${phase === 'done' ? 'stk-send--done' : ''}`}
              onClick={() => void handleSend()}
              disabled={!canSubmit}
              aria-busy={busy || undefined}
            >
              <TokenCoin key={spinKey} size={16} spin={phase === 'done'} />
              <span>
                {phase === 'sending' ? 'Sending…' : phase === 'posting' ? 'Posting…' : phase === 'done' ? 'Sent' : amount ? `Send ${amount.toLocaleString('en-IN')}` : 'Send'}
              </span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
