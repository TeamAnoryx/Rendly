'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Avatar } from '@/components/shell/AppShell';
import { TokenAmount, TokenCoin } from '@/components/brand/TokenCoin';

export type TokenEventKind = 'reward' | 'tip' | 'transfer';

const BADGE: Record<TokenEventKind, string> = {
  reward: 'Host reward',
  tip: 'Tip to host',
  transfer: 'Sent by host',
};

/**
 * Chat card for a Rendly Token transfer inside a huddle: sender → recipient, the amount, and a badge
 * that says at a glance whether it is a host reward or a participant's tip to the host.
 */
export default function TokenEvent({
  kind,
  amount,
  fromName,
  toName,
  fromAvatar,
  toAvatar,
}: {
  kind: TokenEventKind;
  amount: number;
  fromName: string;
  toName: string;
  fromAvatar: string | null;
  toAvatar: string | null;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`hr-tok hr-tok--${kind}`}
      role="status"
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 26 }}
    >
      {reduce ? null : <span className="hr-tok-shine" aria-hidden />}
      <div className="hr-tok-head">
        <span className="hr-tok-badge">{BADGE[kind]}</span>
        <span className="hr-tok-coin" aria-hidden>
          <TokenCoin size={22} spin={!reduce} />
        </span>
      </div>
      <div className="hr-tok-flow">
        <span className="hr-tok-person">
          <Avatar url={fromAvatar} name={fromName} size="sm" />
          <span className="hr-tok-name">{fromName}</span>
        </span>
        <span className="hr-tok-arrow" aria-hidden>
          <span />
        </span>
        <span className="hr-tok-person">
          <Avatar url={toAvatar} name={toName} size="sm" />
          <span className="hr-tok-name">{toName}</span>
        </span>
      </div>
      <div className="hr-tok-amount">
        <TokenAmount amount={amount} size={16} />
        <span className="hr-tok-unit">Rendly Tokens</span>
      </div>
    </motion.div>
  );
}
