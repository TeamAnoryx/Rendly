'use client';

import { useEffect, useRef, useState } from 'react';
import { getSparkQuote, sparkMatchCost } from '@/services/sparkApi';
import { POINTS_CHANGED_EVENT } from '@/services/pointsApi';

const QUOTE_DEBOUNCE_MS = 400;
const KEY_SEPARATOR = '\u0000';

type QuoteState = { cost: number | null; balance: number | null; loading: boolean };

const EMPTY: QuoteState = { cost: null, balance: null, loading: false };

/** Live, debounced server quote for a Spark search on `intents`. Stale responses are ignored. */
export function useSparkQuote(intents: readonly string[]): QuoteState {
  const key = intents.join(KEY_SEPARATOR);
  const [state, setState] = useState<QuoteState>(EMPTY);
  const requestId = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const onPointsChanged = () => setRefreshTick((n) => n + 1);
    window.addEventListener(POINTS_CHANGED_EVENT, onPointsChanged);
    return () => window.removeEventListener(POINTS_CHANGED_EVENT, onPointsChanged);
  }, []);

  useEffect(() => {
    const list = key ? key.split(KEY_SEPARATOR) : [];
    const id = ++requestId.current;
    if (list.length === 0) {
      setState(EMPTY);
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true }));
    const timer = setTimeout(() => {
      getSparkQuote(list)
        .then((q) => {
          if (id === requestId.current) setState({ cost: q.cost, balance: q.balance, loading: false });
        })
        .catch(() => {
          if (id === requestId.current) setState({ cost: sparkMatchCost(list), balance: null, loading: false });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // Invalidate in-flight responses for this key on change or unmount.
      if (id === requestId.current) requestId.current += 1;
    };
  }, [key, refreshTick]);

  return state;
}
