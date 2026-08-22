/**
 * Client mirror of the backend's tailored peer age brackets
 * (`backend/src/common/age.ts`).
 *
 * The backend is authoritative — it re-derives the bracket from the stored date
 * of birth on every read, and `/users/me` returns the resolved bracket's key,
 * label and range alongside the index — but these definitions are needed here to
 * *render* the preference form, which has to show all five cohorts including the
 * ones the user is not in.
 *
 *   [0] Gen-Z Explorers      18 – 23
 *   [1] Young Professionals  24 – 29
 *   [2] Active Adventurers   30 – 35
 *   [3] Experienced Trekkers 36 – 41
 *   [4] Seasoned Explorers   42 – 50+
 *
 * Keep this table byte-for-byte in step with the backend's. The peer clustering
 * rules are enforced server-side against the backend's copy, so a divergence
 * here would not mis-cluster anybody — it would do something subtler and worse,
 * which is label a user with a cohort the engine did not actually use.
 */

export interface AgeBracket {
  index: number;
  key:
    | 'gen-z-explorers'
    | 'young-professionals'
    | 'active-adventurers'
    | 'experienced-trekkers'
    | 'seasoned-explorers';
  /** The cohort name, e.g. "Gen-Z Explorers". */
  label: string;
  minAge: number;
  /** Inclusive upper bound, or null for the open-ended top bracket. */
  maxAge: number | null;
  /** The range as the form renders it, e.g. "18 – 23". */
  rangeLabel: string;
  /** One line on who the cohort is, shown under the name in the picker. */
  blurb: string;
}

export const AGE_BRACKETS: readonly AgeBracket[] = [
  {
    index: 0,
    key: 'gen-z-explorers',
    label: 'Gen-Z Explorers',
    minAge: 18,
    maxAge: 23,
    rangeLabel: '18 – 23',
    blurb: 'First big trails, budget-conscious, up for anything',
  },
  {
    index: 1,
    key: 'young-professionals',
    label: 'Young Professionals',
    minAge: 24,
    maxAge: 29,
    rangeLabel: '24 – 29',
    blurb: 'Fitting real routes around limited leave',
  },
  {
    index: 2,
    key: 'active-adventurers',
    label: 'Active Adventurers',
    minAge: 30,
    maxAge: 35,
    rangeLabel: '30 – 35',
    blurb: 'Peak stamina, chasing the demanding routes',
  },
  {
    index: 3,
    key: 'experienced-trekkers',
    label: 'Experienced Trekkers',
    minAge: 36,
    maxAge: 41,
    rangeLabel: '36 – 41',
    blurb: 'Several seasons in, know exactly what they want',
  },
  {
    index: 4,
    key: 'seasoned-explorers',
    label: 'Seasoned Explorers',
    minAge: 42,
    maxAge: null,
    rangeLabel: '42 – 50+',
    blurb: 'Long-haul trekkers who value pace and comfort',
  },
] as const;

export const AGE_BRACKET_COUNT = AGE_BRACKETS.length;
export const MAX_AGE_BRACKET_INDEX = AGE_BRACKET_COUNT - 1;

/** Minimum age the bracket system covers, and therefore the signup floor. */
export const MIN_BRACKET_AGE = AGE_BRACKETS[0].minAge;

/** Bracket used when nothing better is known. Mirrors the backend's default. */
export const DEFAULT_AGE_BRACKET = 1;

/** Cohort names only, positionally indexed by bracket. */
export const AGE_GROUP_LABELS = AGE_BRACKETS.map(b => b.label);

/** Whole years between `dob` and now, or null when the date is unusable. */
export function calculateAge(dob?: string | Date | null, now: Date = new Date()): number | null {
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

/** Map a whole-year age onto its bracket index, driven off the table above. */
export function ageGroupFromAge(age: number): number {
  for (const bracket of AGE_BRACKETS) {
    if (bracket.maxAge === null || age <= bracket.maxAge) return bracket.index;
  }
  return MAX_AGE_BRACKET_INDEX;
}

/** Force any number into a valid bracket index, so lookups never return undefined. */
export function clampBracket(index: unknown): number {
  const n =
    typeof index === 'number' && Number.isFinite(index) ? Math.round(index) : DEFAULT_AGE_BRACKET;
  return Math.max(0, Math.min(MAX_AGE_BRACKET_INDEX, n));
}

/** The bracket record for an index. Never undefined — the index is clamped. */
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
 * "Gen-Z Explorers · 18 – 23" — the one-line form the signup hint and the
 * locked-bracket subtitles use.
 */
export function ageBracketSummary(bracket: AgeBracket): string {
  return `${bracket.label} · ${bracket.rangeLabel}`;
}
