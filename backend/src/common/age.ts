/**
 * The tailored peer age brackets — the single source of truth for the whole
 * system, backend and (mirrored) client.
 *
 * These are *not* generic age bands. They are the five named cohorts the
 * preference form presents, the recommendation engine clusters on, and the
 * collaborative layer refuses to match across:
 *
 *   [0] Gen-Z Explorers      18 – 23
 *   [1] Young Professionals  24 – 29
 *   [2] Active Adventurers   30 – 35
 *   [3] Experienced Trekkers 36 – 41
 *   [4] Seasoned Explorers   42 – 50+
 *
 * The bracket is *derived*, never stored as a frozen number: every read
 * recomputes it from the account's date of birth, so a user advances into the
 * next cohort by themselves on the day they cross the boundary. The stored
 * `profile.ageGroup` is only ever consulted for legacy accounts that have no DOB
 * on record.
 *
 * Bracket 4 is open-ended by design ("42 – 50+"). Ages below the first bracket's
 * floor clamp to bracket 0 — signup requires 18+, so this only arises for
 * legacy accounts created under an older, lower age gate, and clamping keeps
 * them inside the cohort system rather than leaving them bracketless.
 */

export interface AgeBracket {
  /** Position in the profile vector's `ageGroup` dimension. */
  index: number;
  /** Stable machine key, safe to persist or send over the wire. */
  key: 'gen-z-explorers' | 'young-professionals' | 'active-adventurers' | 'experienced-trekkers' | 'seasoned-explorers';
  /** The cohort name the preference form shows, e.g. "Gen-Z Explorers". */
  label: string;
  /** Inclusive lower bound, in whole years. */
  minAge: number;
  /** Inclusive upper bound, or null for the open-ended top bracket. */
  maxAge: number | null;
  /** The range exactly as the form renders it, e.g. "18 – 23". */
  rangeLabel: string;
}

export const AGE_BRACKETS: readonly AgeBracket[] = [
  { index: 0, key: 'gen-z-explorers',      label: 'Gen-Z Explorers',      minAge: 18, maxAge: 23,   rangeLabel: '18 – 23' },
  { index: 1, key: 'young-professionals',  label: 'Young Professionals',  minAge: 24, maxAge: 29,   rangeLabel: '24 – 29' },
  { index: 2, key: 'active-adventurers',   label: 'Active Adventurers',   minAge: 30, maxAge: 35,   rangeLabel: '30 – 35' },
  { index: 3, key: 'experienced-trekkers', label: 'Experienced Trekkers', minAge: 36, maxAge: 41,   rangeLabel: '36 – 41' },
  { index: 4, key: 'seasoned-explorers',   label: 'Seasoned Explorers',   minAge: 42, maxAge: null, rangeLabel: '42 – 50+' },
] as const;

export const AGE_BRACKET_COUNT = AGE_BRACKETS.length;

/** Highest valid bracket index. Also the divisor that normalises the dimension. */
export const MAX_AGE_BRACKET_INDEX = AGE_BRACKET_COUNT - 1;

/** Minimum age the bracket system covers, and therefore the signup floor. */
export const MIN_BRACKET_AGE = AGE_BRACKETS[0].minAge;

/**
 * The bracket used when an account has no usable date of birth *and* no stored
 * selection — Young Professionals, the most populous cohort for a trekking app
 * and the one whose physical-load assumptions are the least opinionated.
 */
export const DEFAULT_AGE_BRACKET = 1;

/** Labels only, positionally indexed by bracket. Kept for display call sites. */
export const AGE_GROUP_LABELS = AGE_BRACKETS.map(b => b.label);

/** Whole years elapsed between `dob` and `now`, or null for an unusable date. */
export function calculateAge(dob?: Date | string | null, now: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;

  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Map a whole-year age onto its bracket index.
 *
 * Driven off `AGE_BRACKETS` rather than a hand-written ladder of comparisons, so
 * the boundaries can never drift from the ranges the form displays.
 */
export function ageGroupFromAge(age: number): number {
  for (const bracket of AGE_BRACKETS) {
    if (bracket.maxAge === null || age <= bracket.maxAge) return bracket.index;
  }
  return MAX_AGE_BRACKET_INDEX;
}

/**
 * Bracket for a date of birth, or `fallback` when no usable DOB is on record
 * (legacy accounts created before DOB capture).
 */
export function ageGroupFromDob(
  dob?: Date | string | null,
  fallback = DEFAULT_AGE_BRACKET,
  now: Date = new Date()
): number {
  const age = calculateAge(dob, now);
  return age === null ? clampBracket(fallback) : ageGroupFromAge(age);
}

/** Force any number into a valid bracket index. */
export function clampBracket(index: unknown): number {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.round(index) : DEFAULT_AGE_BRACKET;
  return Math.max(0, Math.min(MAX_AGE_BRACKET_INDEX, n));
}

/** The bracket record for an index, clamped so this never returns undefined. */
export function ageBracketFor(index: number): AgeBracket {
  return AGE_BRACKETS[clampBracket(index)];
}

/** Bracket record for an age, or null when the age is unknown. */
export function ageBracketForAge(age: number | null): AgeBracket | null {
  return age === null ? null : ageBracketFor(ageGroupFromAge(age));
}

/** Cohort name for an age, or null when the age is unknown. */
export function ageGroupLabelFor(age: number | null): string | null {
  return ageBracketForAge(age)?.label ?? null;
}

/**
 * How far apart two brackets may be and still be treated as peers.
 *
 * One. Same bracket or immediately adjacent, and nothing further — this is the
 * hard rule that keeps the collaborative layer from matching a 19-year-old
 * against a 48-year-old on the strength of a shared like. Because the brackets
 * are ~6 years wide, "adjacent" is a realistic peer distance; two brackets apart
 * is the unrealistic age gap the clustering exists to exclude.
 */
export const MAX_PEER_BRACKET_GAP = 1;

/**
 * Weight a peer's signal carries as a function of bracket distance.
 * Same bracket counts fully; an adjacent bracket counts half; anything beyond
 * `MAX_PEER_BRACKET_GAP` is not a peer at all and returns 0.
 */
export function peerBracketWeight(gap: number): number {
  if (!Number.isFinite(gap) || gap < 0) return 0;
  if (gap === 0) return 1;
  return gap <= MAX_PEER_BRACKET_GAP ? 0.5 : 0;
}
