/**
 * Shared profile / preference types for the trek recommendation engine.
 *
 * The engine itself runs **server-side** (`backend/src/modules/recommendations`),
 * where it can see every user's interactions, the live like counts and the
 * persisted destination catalogue — none of which the client has. This module
 * used to carry a duplicate client-side KNN pipeline as a stand-in for that
 * backend; it has been removed rather than left to rot, because a second
 * ranking implementation that nothing calls is a source of drift, and its
 * synthetic corpus was built from fabricated per-destination like counts that
 * no longer exist anywhere in the app.
 *
 * What remains is the shared vocabulary: the shapes the onboarding form
 * collects and the auth context stores.
 */

import { Difficulty } from '@/data/destinations';

/**
 * The five-dimensional trekker profile captured during onboarding. The backend
 * projects this into its KNN vector and its deterministic safety matrix.
 */
export interface UserProfile {
  /**
   * The tailored peer age bracket, 0-4 — see `lib/ageGroups.ts` for the cohort
   * names and ranges. Derived from the date of birth whenever one is on record,
   * and the hard boundary the engine's collaborative layer clusters within.
   */
  ageGroup: number;
  /** 0 = beginner, 1 = intermediate, 2 = advanced, 3 = expert. */
  experienceLevel: number;
  /** 0 = poor cardio/respiratory, 1 = good. Safety-critical. */
  cardioFlag: number;
  /** 0 = poor joint stability, 1 = good. Safety-critical. */
  jointFlag: number;
  /** 0 = none, 1 = basic, 2 = moderate, 3 = extensive. */
  altitudeHistory: number;
}

/** The soft constraints the onboarding form collects alongside the profile. */
export interface UserPreferences {
  /** Days. */
  maxDuration: number;
  /** NPR. */
  maxPrice: number;
  difficulty: Difficulty | 'All';
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  maxDuration: 21,
  maxPrice: 300000,
  difficulty: 'All',
};
