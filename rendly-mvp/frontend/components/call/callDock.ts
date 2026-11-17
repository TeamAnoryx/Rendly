'use client';

import { useSyncExternalStore } from 'react';

/**
 * The Whispers page owns a slot (#rd-call-dock) where the call renders beside the chat.
 * The slot registers itself here, so the call always portals into the live element even
 * when the page remounts (opening a conversation on accept used to leave the call in a
 * detached node, so the callee saw nothing).
 */
let dockEl: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setCallDock(el: HTMLElement | null): void {
  if (el === dockEl) return;
  dockEl = el;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): HTMLElement | null {
  return dockEl;
}

/** The current dock slot, or null when no Whispers page is mounted. */
export function useCallDock(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
