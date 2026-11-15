'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from '@/components/shell/Icon';
import { useIntentSheet } from './sheet/useIntentSheet';
import { markSheetSeen, type SheetTab } from './sheet/sheetUtils';
import SheetSummary from './sheet/SheetSummary';
import SheetSearchBar from './sheet/SheetSearchBar';
import SheetResultsGrid from './sheet/SheetResultsGrid';
import SheetTabButtons, { SheetTabPanel } from './sheet/SheetTabs';
import SheetMine from './sheet/SheetMine';
import SheetPresets from './sheet/SheetPresets';
import SheetCustomAdd from './sheet/SheetCustomAdd';
import DefaultMatchToggle from './sheet/DefaultMatchToggle';
import { useSparkLimits } from '@/hooks/useSparkLimits';
import './intent-sheet.css';

export type IntentSheetProps = {
  open: boolean;
  mode: 'text' | 'video';
  anonymous: boolean;
  note: string;
  /** Default (guaranteed match) on/off. */
  matchAny: boolean;
  onMatchAnyChange: (on: boolean) => void;
  onClose: () => void;
  /** `matches` = how many matches this run should make (the limiter in the summary). */
  onSpark: (intents: string[], matches: number) => void;
};

const EASE = [0.2, 0.8, 0.2, 1] as const;
/** Same breakpoint as the Spark page "fit" layout (match.css): there the sheet floats over the left area. */
const FLOAT_QUERY = '(orientation: landscape) and (min-width: 900px) and (min-height: 560px)';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** True when the sheet renders as a bottom sheet (phones, portrait tablets, short screens). */
function useIsBottomSheet(): boolean {
  const [bottom, setBottom] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(FLOAT_QUERY);
    const sync = () => setBottom(!mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return bottom;
}

function contextCaption(mode: IntentSheetProps['mode'], anonymous: boolean): string {
  return `${mode === 'video' ? 'Video' : 'Text first'} · ${anonymous ? 'Anonymous' : 'Public'}`;
}

function SheetBody({ mode, anonymous, note, matchAny, onMatchAnyChange, onClose, onSpark }: Omit<IntentSheetProps, 'open'>) {
  const s = useIntentSheet(true);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SheetTab | null>(null);
  const reduce = useReducedMotion();
  const phone = useIsBottomSheet();
  const { limits } = useSparkLimits();
  const matchesLeft = limits ? Math.max(0, limits.matches_left) : null;
  const [matches, setMatches] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (matchesLeft !== null && matchesLeft > 0) setMatches((m) => Math.min(Math.max(1, m), matchesLeft));
  }, [matchesLeft]);

  const searching = s.query.trim().length > 0;
  const showResults = searching || tab !== null;
  const notEnough = s.balance !== null && s.cost > s.balance;
  const noMatchesLeft = matchesLeft === 0;
  const sparkDisabled = s.names.length === 0 || notEnough || noMatchesLeft;
  const sparkHint =
    s.names.length === 0
      ? 'Pick at least one intent'
      : noMatchesLeft
        ? 'No matches left this hour'
        : notEnough
          ? 'Not enough tokens'
          : null;

  const handleQuery = useCallback(
    (q: string) => {
      if (q.length > 0) setTab(null);
      s.setQuery(q);
    },
    [s],
  );

  const handleTab = useCallback(
    (next: SheetTab | null) => {
      if (next !== null && s.query) s.setQuery('');
      setTab(next);
    },
    [s],
  );

  // Focus the search input on open; restore focus on close.
  useEffect(() => {
    const previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const input = panelRef.current?.querySelector<HTMLInputElement>('input[type="search"], input');
    input?.focus({ preventScroll: true });
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !n.hasAttribute('aria-hidden'),
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const spark = () => {
    if (sparkDisabled) return;
    markSheetSeen();
    onSpark(s.names, matches);
  };

  const t = { duration: reduce ? 0.16 : 0.34, ease: EASE };
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : phone
      ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
      : {
          initial: { opacity: 0, scale: 0.96, x: -12 },
          animate: { opacity: 1, scale: 1, x: 0 },
          exit: { opacity: 0, scale: 0.96, x: -12 },
        };

  return (
    <div className="is-sheet-root">
      <motion.div
        className="is-sheet-backdrop"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={t}
        onClick={phone ? onClose : undefined}
      />
      <motion.div
        ref={panelRef}
        className="is-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        transition={t}
        {...motionProps}
      >
        <div className="is-sheet-summary">
          <SheetSummary
            items={s.summary}
            cost={s.cost}
            balance={s.balance}
            pending={s.quotePending}
            matches={matches}
            matchesLeft={matchesLeft}
            maxPerWindow={limits?.max_per_window ?? null}
            onMatchesChange={setMatches}
            onRemove={(name: string) => s.toggle(name, 'mine')}
          />
        </div>

        <motion.div className="is-sheet-panel" layout={!reduce} transition={t}>
          <span className="is-sheet-handle" aria-hidden="true" />
          <header className="is-sheet-head">
            <div className="is-sheet-titles">
              <h2 id={titleId} className="is-sheet-title">
                Choose your intents
              </h2>
              <p className="is-sheet-caption">
                {contextCaption(mode, anonymous)}
                {note ? <span className="is-sheet-note"> · “{note}”</span> : null}
              </p>
            </div>
            <button type="button" className="is-sheet-close" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </header>

          <SheetSearchBar
            query={s.query}
            onQueryChange={handleQuery}
            sort={s.sort}
            onSortChange={s.setSort}
            loading={s.searchState === 'loading'}
          />

          <div className="is-sheet-row">
            <div className="is-sheet-row-mine">
              <SheetMine
                mine={s.mine}
                state={s.mineState}
                selected={s.names}
                maxReached={s.maxReached}
                onRetry={s.reloadMine}
                onToggle={s.toggle}
              />
            </div>
            <div className="is-sheet-row-tabs">
              <SheetTabButtons value={tab} onChange={handleTab} />
            </div>
            <div className="is-sheet-row-default">
              <DefaultMatchToggle on={matchAny} onChange={onMatchAnyChange} />
            </div>
          </div>

          {s.error && (
            <div className="is-sheet-alert" role="alert">
              <span>{s.error}</span>
              <button type="button" className="is-sheet-alert-x" aria-label="Dismiss" onClick={s.clearError}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {s.limitHit && (
            <p className="is-sheet-limit" role="status">
              Up to 5 intents per Spark
            </p>
          )}

          <AnimatePresence initial={false} mode="popLayout">
            {showResults ? (
              <motion.div
                key={searching ? 'search' : `tab-${tab}`}
                className="is-sheet-results"
                layout={!reduce}
                initial={{ opacity: 0, height: reduce ? 'auto' : 0, y: reduce ? 0 : -6 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: reduce ? 'auto' : 0, y: reduce ? 0 : -6 }}
                transition={reduce ? t : { height: { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }, opacity: { duration: 0.22, ease: EASE }, y: { duration: 0.3, ease: EASE } }}
              >
                {searching ? (
                  <SheetResultsGrid
                    items={s.results}
                    selected={s.names}
                    heldNames={s.heldNames}
                    busyId={s.busyId}
                    maxReached={s.maxReached}
                    loading={s.searchState === 'loading'}
                    error={s.searchState === 'error' ? 'Search failed' : null}
                    onRetry={s.retrySearch}
                    emptyText="No intents match"
                    onPick={(intent) => s.pickIntent(intent, 'mine')}
                  />
                ) : tab ? (
                  <SheetTabPanel
                    tab={tab}
                    selected={s.names}
                    heldNames={s.heldNames}
                    busyId={s.busyId}
                    maxReached={s.maxReached}
                    onPickIntent={s.pickIntent}
                    onSelectName={s.toggle}
                  />
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="presets"
                className="is-sheet-presets"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t}
              >
                <SheetPresets selected={s.names} maxReached={s.maxReached} onToggle={s.toggle} />
              </motion.div>
            )}
          </AnimatePresence>

          <motion.footer className={`is-sheet-foot${adding ? ' is-sheet-foot--adding' : ''}`} layout={!reduce} transition={t}>
            <div className="is-sheet-foot-add">
              <SheetCustomAdd
                disabled={s.maxReached}
                onOpenChange={setAdding}
                onCreated={(name: string) => s.add(name, 'mine')}
              />
            </div>
            <div className="is-sheet-foot-cta">
              {sparkHint && <span className="is-sheet-hint">{sparkHint}</span>}
              <button
                type="button"
                className="rd-btn rd-btn--primary is-sheet-spark"
                disabled={sparkDisabled}
                onClick={spark}
              >
                <Icon name="spark" size={16} />
                <span>Spark now</span>
              </button>
            </div>
          </motion.footer>
        </motion.div>
      </motion.div>
    </div>
  );
}

/** Intent picker overlay for the Spark page: floats over the left area on wide screens, a bottom sheet elsewhere. */
export default function IntentSheet({ open, ...rest }: IntentSheetProps) {
  return <AnimatePresence>{open ? <SheetBody key="intent-sheet" {...rest} /> : null}</AnimatePresence>;
}
