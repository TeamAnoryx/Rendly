/** Pure helpers for the Spark setup screen (selection, labels, validation). */

import { sparkIntentPrice } from '@/services/sparkApi';

export const MAX_SPARK_INTENTS = 5;
export const SPARK_NOTE_MAX = 200;
export const LOCATION_NAME_MIN = 2;
export const LOCATION_NAME_MAX = 60;

/** Where a selected intent came from (drives its icon; price comes from sparkIntentPrice). */
export type SelectedSource = 'preset' | 'mine' | 'hot' | 'location' | 'nearby';

export type SelectedIntent = { name: string; source: SelectedSource };

/** Case-insensitive identity of an intent name. */
export function intentKey(name: string): string {
  return name.trim().toLowerCase();
}

export function isSelected(list: readonly SelectedIntent[], name: string): boolean {
  const key = intentKey(name);
  return list.some((i) => intentKey(i.name) === key);
}

/**
 * Add `item` when absent (unless the list is full), remove it when present. Never mutates `list`.
 * `limited` is true when the add was refused because the list already holds `max` intents.
 */
export function toggleIntent(
  list: readonly SelectedIntent[],
  item: SelectedIntent,
  max: number = MAX_SPARK_INTENTS
): { next: SelectedIntent[]; limited: boolean } {
  const key = intentKey(item.name);
  if (!key) return { next: [...list], limited: false };
  if (list.some((i) => intentKey(i.name) === key)) {
    return { next: list.filter((i) => intentKey(i.name) !== key), limited: false };
  }
  if (list.length >= max) return { next: [...list], limited: true };
  return { next: [...list, { name: item.name.trim(), source: item.source }], limited: false };
}

/** Select `item` if it is not selected yet (no toggle-off). */
export function addIntent(
  list: readonly SelectedIntent[],
  item: SelectedIntent,
  max: number = MAX_SPARK_INTENTS
): { next: SelectedIntent[]; limited: boolean } {
  if (isSelected(list, item.name)) return { next: [...list], limited: false };
  return toggleIntent(list, item, max);
}

/** "#DigitalMarketing" for "Digital Marketing" (display only; the real name is kept as the value). */
export function hashtagLabel(name: string): string {
  return `#${name.replace(/\s+/g, '')}`;
}

/** Per-match price of a selected intent (5 for presets, 10 otherwise). */
export function selectedPrice(item: SelectedIntent): number {
  return sparkIntentPrice(item.name);
}

const LOCATION_NAME_RE = /^[\p{L} .'-]+$/u;

/** Error text for a city/country name, or null when valid (2..60 letters, spaces, . ' -). */
export function validateLocationName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < LOCATION_NAME_MIN) return `Use at least ${LOCATION_NAME_MIN} letters`;
  if (name.length > LOCATION_NAME_MAX) return `Keep it under ${LOCATION_NAME_MAX} characters`;
  if (!LOCATION_NAME_RE.test(name)) return 'Letters, spaces and . \' - only';
  if (!/\p{L}/u.test(name)) return 'Use letters';
  return null;
}

/** Normalised location name sent to the server (trimmed, single spaces). */
export function normalizeLocationName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}
