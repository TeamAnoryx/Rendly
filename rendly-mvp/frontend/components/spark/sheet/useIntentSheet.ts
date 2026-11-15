'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMyIntents,
  purchaseIntent,
  searchIntents,
  type Intent,
  type IntentSource,
  type MyIntent,
} from '@/services/intentsApi';
import { POINTS_CHANGED_EVENT, emitPointsChanged, newIdempotencyKey } from '@/services/pointsApi';
import { SPARK_PRESETS, getSparkQuote, sparkIntentPrice, sparkMatchCost } from '@/services/sparkApi';
import {
  MAX_SPARK_INTENTS,
  addIntent,
  hashtagLabel,
  intentKey,
  toggleIntent,
  type SelectedIntent,
  type SelectedSource,
} from '../setupUtils';
import { SHEET_RESULTS_LIMIT, SHEET_SEARCH_DEBOUNCE_MS, type SheetSort, type SummaryItem } from './sheetUtils';

const QUOTE_DEBOUNCE_MS = 400;
const NAMES_SEP = '\u0000';

type LoadState = 'loading' | 'ok' | 'error';
type SearchState = 'idle' | 'loading' | 'ok' | 'error';

export type IntentSheetState = {
  selected: SelectedIntent[];
  names: string[];
  toggle: (name: string, source: SelectedSource) => void;
  add: (name: string, source: SelectedSource) => void;
  limitHit: boolean;
  maxReached: boolean;
  mine: MyIntent[];
  mineState: LoadState;
  reloadMine: () => Promise<void>;
  heldNames: string[];
  cost: number;
  balance: number | null;
  quotePending: boolean;
  summary: SummaryItem[];
  query: string;
  setQuery: (q: string) => void;
  sort: SheetSort;
  setSort: (s: SheetSort) => void;
  results: Intent[];
  searchState: SearchState;
  retrySearch: () => void;
  pickIntent: (intent: Intent, source: SelectedSource) => Promise<void>;
  busyId: string | null;
  error: string | null;
  clearError: () => void;
};

const PRESET_BY_KEY = new Map<string, string>(SPARK_PRESETS.map((p) => [intentKey(p), p]));

/** Purchase source for a selection source; anything without its own price tier buys as 'search'. */
function purchaseSource(source: SelectedSource): IntentSource {
  return source === 'hot' || source === 'location' || source === 'nearby' ? source : 'search';
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** State and actions for the Spark intent sheet: selection, quote, My intents, search and buy-on-pick. */
export function useIntentSheet(open: boolean): IntentSheetState {
  const [selected, setSelected] = useState<SelectedIntent[]>([]);
  const [limitHit, setLimitHit] = useState(false);

  const [mine, setMine] = useState<MyIntent[]>([]);
  const [mineState, setMineState] = useState<LoadState>('loading');

  const [quote, setQuote] = useState<{ key: string; cost: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const [query, setQueryState] = useState('');
  const [sort, setSortState] = useState<SheetSort>('trending');
  const [results, setResults] = useState<Intent[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchNonce, setSearchNonce] = useState(0);
  const searchSeq = useRef(0);

  const [owned, setOwned] = useState<string[]>([]);
  const [lastPicked, setLastPicked] = useState<Intent | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(() => selected.map((i) => i.name), [selected]);
  const namesKey = names.join(NAMES_SEP);
  const maxReached = selected.length >= MAX_SPARK_INTENTS;

  const toggle = useCallback(
    (name: string, source: SelectedSource) => {
      const { next, limited } = toggleIntent(selected, { name, source });
      setLimitHit(limited);
      setSelected(next);
    },
    [selected]
  );

  const add = useCallback(
    (name: string, source: SelectedSource) => {
      const { next, limited } = addIntent(selected, { name, source });
      setLimitHit(limited);
      setSelected(next);
    },
    [selected]
  );

  // ---- My intents ----
  const reloadMine = useCallback(async () => {
    try {
      const list = await getMyIntents();
      setMine(list.filter((i) => i.kind !== 'preset'));
      setMineState('ok');
    } catch {
      setMineState('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setMineState('loading');
    void reloadMine();
  }, [open, reloadMine]);

  // ---- Quote ----
  const refreshQuote = useCallback(async (list: string[]) => {
    try {
      const q = await getSparkQuote(list);
      setBalance(q.balance);
      setQuote({ key: list.join(NAMES_SEP), cost: q.cost });
    } catch {
      /* the local estimate stays on screen */
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => void refreshQuote(names), QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, namesKey, refreshQuote]);

  useEffect(() => {
    if (!open) return undefined;
    const onPoints = () => {
      void reloadMine();
      void refreshQuote(names);
    };
    window.addEventListener(POINTS_CHANGED_EVENT, onPoints);
    return () => window.removeEventListener(POINTS_CHANGED_EVENT, onPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, namesKey, reloadMine, refreshQuote]);

  const quoteFresh = quote !== null && quote.key === namesKey;
  const cost = quote !== null && quoteFresh ? quote.cost : sparkMatchCost(names);
  const quotePending = open && !quoteFresh;

  // ---- Search ----
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      searchSeq.current += 1;
      setResults([]);
      setSearchState('idle');
      return undefined;
    }
    searchSeq.current += 1;
    const seq = searchSeq.current;
    setSearchState('loading');
    const t = window.setTimeout(() => {
      searchIntents(q, SHEET_RESULTS_LIMIT, sort).then(
        (list) => {
          if (seq !== searchSeq.current) return;
          setResults(list);
          setSearchState('ok');
        },
        () => {
          if (seq !== searchSeq.current) return;
          setSearchState('error');
        }
      );
    }, SHEET_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [open, query, sort, searchNonce]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);
  const setSort = useCallback((s: SheetSort) => setSortState(s), []);
  const retrySearch = useCallback(() => setSearchNonce((n) => n + 1), []);

  // ---- Pick (buy if needed, then select) ----
  const heldNames = useMemo(() => [...mine.map((i) => i.name), ...owned], [mine, owned]);

  const pickIntent = useCallback(
    async (intent: Intent, source: SelectedSource) => {
      const key = intentKey(intent.name);
      setLastPicked(intent);
      const already =
        names.some((n) => intentKey(n) === key) ||
        heldNames.some((n) => intentKey(n) === key) ||
        intent.owned === true ||
        intent.is_mine === true;
      if (already) {
        toggle(intent.name, source);
        return;
      }
      setBusyId(intent.id);
      setError(null);
      try {
        const res = await purchaseIntent(intent.id, purchaseSource(source), newIdempotencyKey());
        if (res.status === 'ok') emitPointsChanged();
        setOwned((prev) => [...prev, intent.name]);
        toggle(intent.name, source);
      } catch (e) {
        setError(errorMessage(e, 'Could not add this intent'));
      } finally {
        setBusyId(null);
      }
    },
    [names, heldNames, toggle]
  );

  const clearError = useCallback(() => setError(null), []);

  // ---- Summary ----
  const summary = useMemo<SummaryItem[]>(() => {
    const known: Intent[] = [...results, ...mine, ...(lastPicked ? [lastPicked] : [])];
    return selected.map((item) => {
      const key = intentKey(item.name);
      const preset = item.source === 'preset' ? PRESET_BY_KEY.get(key) : undefined;
      const match = known.find((i) => intentKey(i.name) === key);
      return {
        name: item.name,
        label: preset ?? hashtagLabel(item.name),
        count: match ? Number(match.usage_count ?? 0) : null,
        price: sparkIntentPrice(item.name),
      };
    });
  }, [selected, results, mine, lastPicked]);

  return {
    selected,
    names,
    toggle,
    add,
    limitHit,
    maxReached,
    mine,
    mineState,
    reloadMine,
    heldNames,
    cost,
    balance,
    quotePending,
    summary,
    query,
    setQuery,
    sort,
    setSort,
    results,
    searchState,
    retrySearch,
    pickIntent,
    busyId,
    error,
    clearError,
  };
}
