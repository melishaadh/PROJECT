/**
 * The people the suite signs up, read from the same dataset the API-level script
 * uses: `scripts/data/trekeasy-users.json`.
 *
 * The transformations here mirror what the *app* would do with each row, and
 * nothing more — the DOB is split into the three fields the signup form asks
 * for, and the username and password are shaped to what the form will accept.
 * The onboarding answers are derived deterministically from the email so that a
 * re-run taps exactly the same chips.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// The app's own bracket table, not a copy of it. `lib/ageGroups.ts` has no
// imports at all, which is what lets a plain Node test runner share the exact
// definitions the form renders from.
import { AGE_BRACKETS, MIN_BRACKET_AGE } from '@/lib/ageGroups';

import { mulberry32, pickWeighted, seedFrom } from './random';

/** One row of the source dataset, as written in `trekeasy-users.json`. */
export interface SeedUser {
  username: string;
  email: string;
  password: string;
  /** DD-MM-YYYY, exactly as written in the source document. */
  dob: string;
  age: number;
  cohort: string;
}

export interface TestUser {
  /** What goes in the Username field. */
  name: string;
  email: string;
  password: string;
  /** The three date-of-birth inputs the form renders. */
  dob: { day: string; month: string; year: string };
  /** Whole years as of now — what the form itself computes and validates. */
  age: number;
  /** Bracket index the app will show as selected, derived from the DOB. */
  bracketIndex: number;
  bracketKey: string;
  documentedCohort: string;
  /** The chips to tap on the onboarding form. */
  answers: {
    experienceLevel: number;
    cardioFlag: number;
    jointFlag: number;
    altitudeHistory: number;
  };
  profile: { bio: string; socialMediaLink: string };
  /** Set when the form itself would refuse this row — see `age` below. */
  skipReason?: string;
}

const DATA_FILE = resolve(__dirname, '../../scripts/data/trekeasy-users.json');

/**
 * The API's name field allows letters, spaces, apostrophes, dots and hyphens
 * only, so usernames carrying a disambiguating digit (`rohankc0`) have it
 * dropped. Names are not unique in the schema — only email is — so the resulting
 * collision is harmless.
 */
function toName(username: string): string {
  return username.replace(/[^\p{L}\p{M}\s'’.-]/gu, '').trim();
}

/** The API rejects passwords under 8 characters; pad the short ones. */
function toPassword(password: string): string {
  let out = password;
  while (out.length < 8) out += '123';
  return out;
}

function ageFrom(day: string, month: string, year: string, now = new Date()): number {
  const birth = new Date(`${year}-${month}-${day}`);
  if (Number.isNaN(birth.getTime())) return -1;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** Experience rises with the bracket; cardio and joint health fall. */
const BY_BRACKET = [
  { experience: [0.45, 0.35, 0.15, 0.05], cardio: 0.9, joint: 0.95 },
  { experience: [0.25, 0.4, 0.25, 0.1], cardio: 0.85, joint: 0.9 },
  { experience: [0.15, 0.35, 0.35, 0.15], cardio: 0.8, joint: 0.85 },
  { experience: [0.1, 0.25, 0.4, 0.25], cardio: 0.7, joint: 0.75 },
  { experience: [0.1, 0.2, 0.35, 0.35], cardio: 0.6, joint: 0.65 },
] as const;

const LOCATIONS = [
  'Kathmandu', 'Pokhara', 'Lalitpur', 'Bhaktapur', 'Chitwan',
  'Butwal', 'Biratnagar', 'Dharan', 'Nepalgunj', 'Hetauda',
];

function bracketForAge(age: number) {
  return AGE_BRACKETS.find(b => b.maxAge === null || age <= b.maxAge) ?? AGE_BRACKETS[4];
}

export function toTestUser(seed: SeedUser, now = new Date()): TestUser {
  const [day, month, year] = seed.dob.split('-');
  const age = ageFrom(day, month, year, now);
  const bracket = bracketForAge(Math.max(age, MIN_BRACKET_AGE));

  const rng = mulberry32(seedFrom(seed.email));
  const shape = BY_BRACKET[bracket.index];
  const experienceLevel = pickWeighted(rng, shape.experience);
  const cardioFlag = rng() < shape.cardio ? 1 : 0;
  const jointFlag = rng() < shape.joint ? 1 : 0;
  const altitudeHistory = Math.max(
    0,
    Math.min(3, experienceLevel + (rng() < 0.35 ? -1 : rng() < 0.75 ? 0 : 1))
  );
  const location = LOCATIONS[Math.floor(rng() * LOCATIONS.length)];

  return {
    name: toName(seed.username),
    email: seed.email,
    password: toPassword(seed.password),
    dob: { day, month, year },
    age,
    bracketIndex: bracket.index,
    bracketKey: bracket.key,
    documentedCohort: seed.cohort,
    answers: { experienceLevel, cardioFlag, jointFlag, altitudeHistory },
    profile: {
      bio: `${bracket.label} · ${location}. Here for the Himalayas.`,
      socialMediaLink: `https://instagram.com/${seed.username}`,
    },
    // The signup screen refuses anyone under 18, so a row whose date of birth
    // has not yet reached that is not a bug to be worked around — it is the form
    // behaving correctly, and the suite records it as skipped rather than
    // driving the UI into an error it is supposed to produce.
    skipReason:
      age < MIN_BRACKET_AGE
        ? `age ${age} today is under the ${MIN_BRACKET_AGE}+ signup floor (document says ${seed.age})`
        : undefined,
  };
}

/** Every row in the dataset, in document order, shaped for the UI. */
export function loadTestUsers(options: { limit?: number; start?: number; cohort?: string } = {}): TestUser[] {
  const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as { users?: SeedUser[] } | SeedUser[];
  let rows = Array.isArray(parsed) ? parsed : parsed.users ?? [];

  if (options.cohort) {
    const needle = options.cohort.toLowerCase();
    rows = rows.filter(r => r.cohort.toLowerCase().includes(needle));
  }

  const start = options.start ?? 0;
  const end = options.limit === undefined ? rows.length : start + options.limit;
  return rows.slice(start, end).map(r => toTestUser(r));
}

/**
 * Selection is driven by environment variables so a run can be narrowed without
 * editing the spec — `E2E_USER_LIMIT=3 npm run e2e:test` for a smoke run.
 */
export function selectionFromEnv(): { limit?: number; start?: number; cohort?: string } {
  const num = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    limit: num(process.env.E2E_USER_LIMIT),
    start: num(process.env.E2E_USER_START),
    cohort: process.env.E2E_USER_COHORT,
  };
}
