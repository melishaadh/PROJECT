import { useSyncExternalStore } from 'react';

/**
 * Whether the visitor has explicitly chosen to browse without an account.
 *
 * Unauthenticated visitors land on the marketing page by default. Tapping
 * "Browse treks as a guest" flips this on for the rest of the session, which
 * is what stops the auth gate from bouncing them straight back to the landing
 * page. It is deliberately in-memory only: every fresh launch starts at the
 * landing page again.
 */
let guestMode = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

export function setGuestMode(value: boolean): void {
  if (guestMode === value) return;
  guestMode = value;
  emit();
}

export function isGuestMode(): boolean {
  return guestMode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuestMode(): boolean {
  return useSyncExternalStore(subscribe, isGuestMode, isGuestMode);
}
