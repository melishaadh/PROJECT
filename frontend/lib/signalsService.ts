/**
 * signalsService.ts
 *
 * Passive engagement reporting for the For You feed — how long a card was held
 * on screen, and which cards were scrolled straight past.
 *
 * Three rules shape this module:
 *
 *  1. **It must never affect the UI.** Every failure is swallowed. A signal is
 *     telemetry that improves tomorrow's ranking; dropping one costs nothing,
 *     while an error surfacing mid-scroll costs the user their place.
 *  2. **It must not chatter.** Signals fire constantly while scrolling, so they
 *     accumulate in memory and flush on a timer (or when the screen loses
 *     focus), as one request rather than one per card.
 *  3. **It must not double-count.** Dwell for the same card within a session is
 *     merged, so a card scrolled past three times is one row with three views,
 *     matching how the backend accumulates it.
 */

import { getToken } from '@/context/AuthContext';

import { API_URL } from './apiConfig';

export type SignalType = 'view' | 'dismiss';

interface PendingSignal {
  trekId: string;
  type: SignalType;
  dwellMs: number;
}

/** How long to gather signals before sending them as one batch. */
const FLUSH_INTERVAL_MS = 10_000;

/** Matches the backend DTO's `ArrayMaxSize`. */
const MAX_BATCH = 60;

/**
 * Below this, a card was not really looked at — it passed under the viewport
 * during a fast scroll. Filtered client-side so the request stays small; the
 * backend applies its own floor when weighting.
 */
export const MIN_TRACKED_DWELL_MS = 800;

/**
 * A card seen at least this many times, never for long and never liked, counts
 * as a deliberate skip rather than an accident.
 */
export const DISMISS_AFTER_GLANCES = 3;

const pending = new Map<string, PendingSignal>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const keyFor = (trekId: string, type: SignalType) => `${type}:${trekId}`;

/** Queue one signal. Cheap and synchronous — safe to call from a scroll handler. */
export function queueSignal(trekId: string, type: SignalType, dwellMs = 0): void {
  if (!trekId) return;
  if (type === 'view' && dwellMs < MIN_TRACKED_DWELL_MS) return;

  const key = keyFor(trekId, type);
  const existing = pending.get(key);
  if (existing) existing.dwellMs += dwellMs;
  else pending.set(key, { trekId, type, dwellMs });

  if (!flushTimer) {
    flushTimer = setTimeout(() => { void flushSignals(); }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Send everything queued. Called on the timer and on screen blur.
 *
 * The queue is drained *before* the request goes out, so a slow or failing
 * flush cannot make the next one re-send the same rows — at worst a batch is
 * lost, which is the correct trade for telemetry.
 */
export async function flushSignals(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;

  const batch = Array.from(pending.values()).slice(0, MAX_BATCH);
  pending.clear();

  try {
    const token = await getToken();
    if (!token) return; // Guests generate no signals.

    await fetch(`${API_URL}/users/me/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        signals: batch.map(s => ({
          trekId: s.trekId,
          type: s.type,
          dwellMs: Math.round(s.dwellMs),
        })),
      }),
    });
  } catch {
    // Deliberately silent — see the note at the top of this file.
  }
}

/** Drop anything queued without sending it. Used on sign-out. */
export function resetSignals(): void {
  pending.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
