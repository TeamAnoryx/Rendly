/** Pure helpers, types and constants shared by the Spark intent sheet (no React). */

import type { IntentSearchSort } from '@/services/intentsApi';
import { compactCount } from '@/utils/formatCount';
import { hashtagLabel } from '../setupUtils';

export type SheetSort = IntentSearchSort;

export const SHEET_SORTS: readonly { value: SheetSort; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Popularity' },
  { value: 'most_used', label: 'Mostly used' },
];

export type SheetTab = 'location' | 'nearby' | 'hot';

export const SHEET_TABS: readonly { value: SheetTab; label: string; icon: string }[] = [
  { value: 'location', label: 'City / Country', icon: 'globe' },
  { value: 'nearby', label: 'Nearby', icon: 'map-pin' },
  { value: 'hot', label: 'Hot', icon: 'flame' },
];

export const SHEET_SEARCH_DEBOUNCE_MS = 300;
export const SHEET_RESULTS_LIMIT = 24;
export const HOT_TOP_N = 10;
export const SHEET_SEEN_KEY = 'rendly.spark.sheetSeen';

/** Compact usage count for the "[2k]" box on a tile. */
export function countBox(n: number): string {
  return compactCount(n);
}

/** "#DigitalMarketing" label for a result tile. */
export function tileLabel(name: string): string {
  return hashtagLabel(name);
}

export type SummaryItem = { name: string; label: string; count: number | null; price: number };

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The sheet was already shown in this browser session. */
export function hasSeenSheet(): boolean {
  try {
    return sessionStore()?.getItem(SHEET_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the sheet was shown in this browser session. */
export function markSheetSeen(): void {
  try {
    sessionStore()?.setItem(SHEET_SEEN_KEY, '1');
  } catch {
    /* storage unavailable: the sheet may show again, which is harmless */
  }
}
