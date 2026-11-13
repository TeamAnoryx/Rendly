'use client';

import React from 'react';
import { TokenCoin } from '@/components/brand/TokenCoin';

export type TokenTransferCardProps = {
  /** Whole number of Rendly Tokens moved by this message. */
  amount: number;
  /** Optional note the sender attached (≤140 chars). */
  note?: string | null;
  /** True when the current user sent the tokens. */
  isSender: boolean;
  /** Pre-formatted time label (e.g. "14:02"); rendered in the card footer. */
  timeLabel?: string;
  /** Optional trailing status node (sent/read checks) placed after the time. */
  status?: React.ReactNode;
};

/** Human preview for a token transfer message, used in chat list rows and reply quotes. */
export function tokenTransferPreview(amount: number | null | undefined, isSender: boolean): string {
  const n = Number.isFinite(Number(amount)) ? Math.max(0, Math.trunc(Number(amount))) : 0;
  const formatted = n.toLocaleString('en-IN');
  return isSender ? `Sent ${formatted} Rendly Tokens` : `Received ${formatted} Rendly Tokens`;
}

/** Message bubble body for `content_type === 'token_transfer'`. Styles: whispers.css (.tt-card*). */
export default function TokenTransferCard({ amount, note, isSender, timeLabel, status }: TokenTransferCardProps) {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  const formatted = safe.toLocaleString('en-IN');
  const headline = isSender ? `You sent ${formatted} Rendly Tokens` : `+${formatted} Rendly Tokens`;
  const trimmedNote = (note ?? '').trim();

  return (
    <div
      className={`tt-card ${isSender ? 'tt-card--sent' : 'tt-card--received'}`}
      role="group"
      aria-label={isSender ? `You sent ${formatted} Rendly Tokens` : `You received ${formatted} Rendly Tokens`}
    >
      <div className="tt-card-inner">
        <div className="tt-card-coin">
          <TokenCoin size={34} />
        </div>
        <div className="tt-card-body">
          <div className="tt-card-amount">{headline}</div>
          <div className="tt-card-sub">{isSender ? 'Rendly Tokens sent' : 'Rendly Tokens received'}</div>
          {trimmedNote ? <div className="tt-card-note">&ldquo;{trimmedNote}&rdquo;</div> : null}
        </div>
      </div>
      {(timeLabel || status) && (
        <div className="tt-card-meta">
          {timeLabel ? <span className="tt-card-time">{timeLabel}</span> : null}
          {status}
        </div>
      )}
    </div>
  );
}
