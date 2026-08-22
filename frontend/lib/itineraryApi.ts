/**
 * itineraryApi.ts
 *
 * On-demand personalized itinerary generation through the NestJS backend
 * (`/itinerary`). Generation requires login (the JWT AuthContext stores);
 * the locations list (for autocomplete) is public.
 */

import { getToken } from '@/context/AuthContext';

import { API_URL } from './apiConfig';

// Complex treks can take a while to plan — match the backend's compute budget.
const ITINERARY_TIMEOUT = 45000;

export type ActivityType =
  | 'road_travel' | 'flight' | 'trekking' | 'rest' | 'acclimatization'
  | 'checkpoint_stop' | 'meal_break' | 'recovery_break' | 'sightseeing';

/**
 * One way of making a transfer leg. Mirrors `TransferOption` in the backend's
 * `data/transport.ts`.
 */
export interface TransferOption {
  mode: 'road_travel' | 'flight';
  /** Always 0 for flights — air miles are not ground distance. */
  distanceKm: number;
  durationHours: number;
  detail: string;
  caution?: string;
  /** The option the plan's own hours are costed against. Exactly one is set. */
  recommended: boolean;
}

export interface ActivityDetail {
  type: ActivityType;
  from: string;
  to: string;
  distance: number;
  elevationGain: number;
  durationHours: number;
  effortScore: number;
  description: string;
  /**
   * Present only on the transfer legs that connect the user's own start/finish
   * to the trek's endpoints. More than one entry means the journey can honestly
   * be made either way and the choice is the traveller's.
   */
  options?: TransferOption[];
}

export interface ItineraryDay {
  day: number;
  activities: ActivityDetail[];
  totalHours: number;
  totalDistance: number;
  totalElevationGain: number;
  maxAltitude: number;
  overnightLocation: string;
  notes: string[];
}

export interface PersonalizedItinerary {
  trekName: string;
  totalDays: number;
  totalDistance: number;
  totalEffort: number;
  maxAltitude: number;
  suitability: 'Low' | 'Moderate' | 'High';
  cautions: string[];
  origin: string;
  finalDestination: string;
  days: ItineraryDay[];
  rejectionReason?: string;
  minimumSafeDays?: number;
  recommendedDays?: number;
}

export interface GenerateParams {
  pace?: string;
  fitnessLevel?: string;
  trekkingExperience?: string;
  targetDays?: number;
  age?: number;
  weight?: number;
  groupSize?: number;
  startLocation?: string;
  finalDestination?: string;
}

export class ItineraryTimeoutError extends Error {}

/**
 * Thrown when the caller cancelled the request through `signal` — almost always
 * because a newer generate superseded it. Distinct from a timeout so the screen
 * can drop it silently instead of showing the user a failure they didn't cause.
 */
export class ItineraryCancelledError extends Error {}

/**
 * The backend refused because the account has not saved its trek preferences.
 * Distinct from a generic failure so the screen can send the user to the
 * preferences form instead of offering a pointless "try again".
 */
export class ItineraryPreferencesRequiredError extends Error {}

/**
 * Generate a personalized itinerary for a trek.
 *
 * Throws `ItineraryTimeoutError` on timeout, `ItineraryCancelledError` when the
 * caller aborts via `signal`, and a generic Error on network/backend failure, so
 * the screen can tell the three apart. Returns the itinerary (which may carry a
 * `rejectionReason` rather than days).
 */
export async function generate(
  trekId: string,
  params: GenerateParams,
  signal?: AbortSignal,
): Promise<PersonalizedItinerary> {
  if (signal?.aborted) throw new ItineraryCancelledError();

  const token = await getToken();
  if (!token) throw new Error('You must be logged in to generate an itinerary.');

  // One controller drives the fetch; either the timeout or the caller's signal
  // can trip it. `timedOut` is what tells the two apart afterwards, since an
  // aborted fetch reports the same AbortError either way.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ITINERARY_TIMEOUT);

  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);

  try {
    const res = await fetch(`${API_URL}/itinerary/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trekId, ...params }),
      signal: controller.signal,
    });
    // 403 is the server's preferences gate (see `ItineraryService.generate`).
    // Surfaced as its own error so the screen routes the user to the form.
    if (res.status === 403) throw new ItineraryPreferencesRequiredError();
    if (!res.ok) throw new Error(`Itinerary request failed (${res.status})`);
    return (await res.json()) as PersonalizedItinerary;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw timedOut ? new ItineraryTimeoutError() : new ItineraryCancelledError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Distinct place names for the location autocomplete. Empty on error. */
export async function getLocations(): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/itinerary/locations`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
