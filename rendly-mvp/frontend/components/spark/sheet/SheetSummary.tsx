'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { TokenCoin } from '@/components/brand/TokenCoin';
import { MAX_SPARK_INTENTS, intentKey } from '../setupUtils';
import { countBox, type SummaryItem } from './sheetUtils';
import './sheet-parts.css';

export type SheetSummaryProps = {
  items: SummaryItem[];
  cost: number;
  balance: number | null;
  pending: boolean;
  /** Matches this run will make (limiter), and how many the hourly limit still allows. */
  matches: number;
  matchesLeft: number | null;
  maxPerWindow: number | null;
  onMatchesChange(n: number): void;
  onRemove(name: string): void;
};

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Selected intents + per-match total, shown above the sheet at the same width. */
export default function SheetSummary({
  items,
  cost,
  balance,
  pending,
  matches,
  matchesLeft,
  maxPerWindow,
  onMatchesChange,
  onRemove,
}: SheetSummaryProps) {
  const reduce = useReducedMotion();
  const short = balance !== null && cost > balance;
  const cap = matchesLeft ?? 20;
  const total = cost * matches;
  const overRun = !short && balance !== null && cost > 0 && total > balance;
  const affordable = balance !== null && cost > 0 ? Math.floor(balance / cost) : null;
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.85 },
      };

  return (
    <section className="is-summary" aria-label="Selected intents" aria-live="polite">
      <div className="is-summary-head">
        <span className="is-summary-title">Selected</span>
        <span className="is-summary-counter">
          {items.length}/{MAX_SPARK_INTENTS}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="is-summary-empty">No intents selected yet</p>
      ) : (
        <ul className="is-summary-pills">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={intentKey(item.name)}
                layout={!reduce}
                className="is-summary-pill"
                transition={{ duration: 0.2, ease: EASE }}
                {...motionProps}
              >
                {item.count !== null && <span className="is-count-box">{countBox(item.count)}</span>}
                <span className="is-summary-label">{item.label}</span>
                <button
                  type="button"
                  className="is-summary-x"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => onRemove(item.name)}
                >
                  <Icon name="close" size={12} strokeWidth={2} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <div className="is-summary-foot">
        <div className="is-limiter" role="group" aria-label="Matches this run">
          <span className="is-limiter-label">Matches</span>
          <button
            type="button"
            className="is-step"
            aria-label="Fewer matches"
            disabled={matches <= 1}
            onClick={() => onMatchesChange(Math.max(1, matches - 1))}
          >
            −
          </button>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={matches}
              className="is-step-value"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              {matches}
            </motion.span>
          </AnimatePresence>
          <button
            type="button"
            className="is-step"
            aria-label="More matches"
            disabled={matches >= cap}
            onClick={() => onMatchesChange(Math.min(cap, matches + 1))}
          >
            +
          </button>
          {matchesLeft !== null && (
            <span className="is-limiter-left">
              {matchesLeft}
              {maxPerWindow ? `/${maxPerWindow}` : ''} left this hour
            </span>
          )}
        </div>
        <p className={`is-summary-total${pending ? ' is-dim' : ''}`}>
          <TokenCoin size={14} /> <strong>{cost}</strong>
          <span className="is-summary-x-sep">×</span>
          <strong>{matches}</strong>
          <span className="is-summary-x-sep">=</span>
          <strong className="is-summary-grand">{total}</strong> tokens
        </p>
      </div>
      <AnimatePresence initial={false}>
        {(short || overRun) && (
          <motion.p
            key={short ? 'short' : 'over'}
            className="is-summary-warn"
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {short
              ? `Not enough tokens for one match (balance ${balance}).`
              : `${matches} matches need ${total} tokens but you have ${balance}. You can afford ${affordable}.`}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
