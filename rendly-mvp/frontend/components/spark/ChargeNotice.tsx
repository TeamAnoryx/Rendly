'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { TokenCoin } from '@/components/brand/TokenCoin';
import './charge-notice.css';

const SEEN_KEY = 'rendly.spark.chargeNoticeSeen';
const EASE = [0.2, 0.8, 0.2, 1] as const;
const RULE_TITLE =
  'Charged only for intents you share, once a chat lasts 30 seconds. Skip sooner and neither of you pays; after that you both do.';

/** True until the 30 s notice has been shown this session. */
export function shouldShowChargeNotice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === null;
  } catch {
    return false;
  }
}

export function markChargeNoticeSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable: notice may show again, harmless */
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Countdown ring: track + white arc that fills as `progress` (0..1) grows. */
function Ring({ radius, stroke, progress, label }: { radius: number; stroke: number; progress: number; label?: string }): JSX.Element {
  const size = (radius + stroke) * 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp01(progress));
  return (
    <span className="cn-ring" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="cn-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="cn-ring-bar"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {label !== undefined && <span className="cn-ring-num">{label}</span>}
    </span>
  );
}

export type ChargeNoticeProps = {
  open: boolean;
  secondsLeft: number;
  progress: number;
  onDismiss: () => void;
};

/** One-time banner explaining the 30 s free window. The caller decides when to close it. */
export default function ChargeNotice({ open, secondsLeft, progress, onDismiss }: ChargeNoticeProps): JSX.Element | null {
  const reduce = useReducedMotion();
  const seconds = Math.max(0, Math.ceil(secondsLeft));
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="cn"
          className="cn-notice"
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
          transition={reduce ? { duration: 0 } : { duration: 0.32, ease: EASE }}
        >
          <Ring radius={14} stroke={2.5} progress={progress} label={String(seconds)} />
          <p className="cn-text">
            Free for the first 30 seconds: skip before then and neither of you pays. After that you both pay, only for intents you share.
          </p>
          <button type="button" className="cn-dismiss" aria-label="Dismiss" onClick={onDismiss}>
            <Icon name="close" size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type ChargeChipProps = {
  state: 'pending' | 'charged' | 'waived';
  secondsLeft: number;
  cost: number;
  className?: string;
};

/** Compact pill showing where the match charge stands. */
export function ChargeChip({ state, secondsLeft, cost, className }: ChargeChipProps): JSX.Element {
  const classes = ['cn-chip', `cn-chip--${state}`, className ?? ''].filter(Boolean).join(' ');
  const seconds = Math.max(0, Math.ceil(secondsLeft));
  return (
    <span className={classes} title={RULE_TITLE} aria-live="polite">
      {state === 'pending' && (
        <>
          <Ring radius={5} stroke={1.5} progress={1 - Math.min(1, seconds / 30)} />
          <span>{seconds > 0 ? `Free for ${seconds}s` : 'Settling…'}</span>
        </>
      )}
      {state === 'charged' && (
        <>
          <TokenCoin size={12} />
          <span>Charged {cost} tokens</span>
        </>
      )}
      {state === 'waived' && <span>Not charged</span>}
    </span>
  );
}
