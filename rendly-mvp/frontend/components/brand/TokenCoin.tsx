import React from 'react';
import { RendlyMark } from './Brand';

/**
 * Rendly Tokens coin: a round gold coin with the Rendly mark pressed into the face.
 * Styles live in styles/rendly-theme.css (.rd-coin, .rd-coin-face, .rd-coin-mark, .rd-coin--spin).
 * The shimmer is CSS-only and turns off under prefers-reduced-motion.
 */
export type TokenCoinProps = {
  /** Diameter in px. */
  size?: number;
  /** One-shot flip for the "sent" moment; re-mount or toggle the key to replay. */
  spin?: boolean;
  className?: string;
  /** When given, the coin is announced to screen readers; otherwise it is decorative. */
  title?: string;
};

export function TokenCoin({ size = 16, spin = false, className, title }: TokenCoinProps) {
  const classes = ['rd-coin', spin ? 'rd-coin--spin' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      <span className="rd-coin-face">
        <RendlyMark className="rd-coin-mark" />
      </span>
    </span>
  );
}

export type TokenAmountProps = {
  amount: number;
  /** Coin diameter in px (defaults to 14). */
  size?: number;
  /** Prefix a +/− sign and colour the number green (credit) or red (debit). */
  signed?: boolean;
  className?: string;
  locale?: string;
};

/** Coin + formatted amount, e.g. "◉ 1,250" or "◉ +50" / "◉ −20" when `signed`. */
export function TokenAmount({ amount, size = 14, signed = false, className, locale = 'en-IN' }: TokenAmountProps) {
  const safe = Number.isFinite(amount) ? amount : 0;
  const magnitude = Math.abs(safe).toLocaleString(locale);
  const tone = !signed ? '' : safe < 0 ? 'rd-amount--minus' : 'rd-amount--plus';
  const sign = !signed ? '' : safe < 0 ? '−' : '+';
  const classes = ['rd-amount', tone, className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      <TokenCoin size={size} />
      <span className="rd-amount-num">
        {sign}
        {magnitude}
      </span>
    </span>
  );
}

export default TokenCoin;
