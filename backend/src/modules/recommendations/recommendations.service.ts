import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@/modules/users/users.service';
import { DestinationsService } from '@/modules/destinations/destinations.service';
import { DestinationDocument } from '@db/schemas/destination.schema';
import {
  TREK_METADATA,
  TrekMeta,
  Difficulty,
  PriceTier,
  PRICE_TIER_ORDINAL,
  PRICE_BOUNDS,
  DURATION_BOUNDS,
  priceTierFor,
  difficultyFor,
  altitudeHistoryFor,
  idealBracketFor,
} from '@/data/trek-metadata';
import {
  AgeBracket,
  DEFAULT_AGE_BRACKET,
  MAX_AGE_BRACKET_INDEX,
  MAX_PEER_BRACKET_GAP,
  ageBracketFor,
  ageGroupFromDob,
  clampBracket,
  peerBracketWeight,
} from '@/common/age';
import { CACHE_TTL, CacheService, CacheTag } from '@/common/cache.service';

/**
 * Multi-layer recommendation engine (backend).
 *
 * The feed is not a static ranking of the whole catalogue — it is a small,
 * tightly curated selection that evolves with the user, the way a reels-style
 * feed does. Four layers combine, then one hard filter runs last:
 *
 *   L1 · Popularity      — the trending leaderboard, aggregated live from the
 *                          likes collection. This is the *same* leaderboard the
 *                          Explore tab's "Trending Now" renders, reached through
 *                          the same `getTrending` call, so the cold-start
 *                          padding and Explore can never disagree. It carries
 *                          the cold start and never outranks a poor personal fit
 *                          (see `suitability`).
 *   L2 · Attribute KNN   — weighted Euclidean distance between the user's 5D
 *                          profile vector (onboarding answers + the DOB-derived
 *                          age bucket) and each route's ideal-trekker vector.
 *                          Safety-critical dimensions carry the heaviest
 *                          weights *and* an exponential penalty, so a
 *                          mismatched risk profile blows the distance up rather
 *                          than merely nudging it.
 *   L3 · Behavioural     — six dimensions learned simultaneously from the user's
 *        affinity          own likes *and* the completed treks on their profile:
 *                            · region association (multi-region: Annapurna +
 *                              Everest is a first-class state, not a tie-break)
 *                            · difficulty / category tiers
 *                            · the exact price band of liked routes
 *                            · the exact duration band of liked routes
 *                            · semantic title & keyword token overlap
 *                            · similarity to the specific routes already liked
 *                          It engages at full strength from the **2nd like**.
 *   L4 · Collaborative   — cohort matching under **strict age-bracket
 *        filtering         clustering**. Peers more than one tailored bracket
 *                          away are excluded outright — a 19-year-old is never
 *                          matched against a 48-year-old however much their
 *                          likes overlap. Inside that cluster peers are scored
 *                          on like-set overlap (Jaccard) plus bracket distance
 *                          plus profile proximity, and a peer who is both in the
 *                          user's exact bracket *and* shares likes is amplified.
 *                          The routes the cohort liked and the user has not are
 *                          boosted.
 *
 *   Safety matrix        — a deterministic interceptor that hard-drops routes
 *                          unsafe for the user's medical flags, regardless of
 *                          how well they score on every other layer.
 *
 * The blend uses *sliding* weights: with no interaction history the feed is
 * pure onboarding fit + popularity (cold start); as likes accumulate the weight
 * slides onto behavioural affinity and then collaborative filtering. Because the
 * whole blend is recomputed per request from the like collection, and every like
 * busts this user's cached feed write-through, the adaptation lands on the very
 * next fetch — the client re-fetches on every confirmed like, so there is no
 * manual refresh anywhere in the loop.
 */

// ─── Evaluation matrix: feature weights (safety-critical dominate) ─────────────
export const FEATURE_WEIGHTS = {
  ageGroup: 2.5, // age-to-difficulty alignment
  experienceLevel: 1.5,
  cardioFlag: 6.0, // safety-critical
  jointFlag: 6.0, // safety-critical
  altitudeHistory: 2.0,
} as const;

const WEIGHT_VECTOR = [
  FEATURE_WEIGHTS.ageGroup,
  FEATURE_WEIGHTS.experienceLevel,
  FEATURE_WEIGHTS.cardioFlag,
  FEATURE_WEIGHTS.jointFlag,
  FEATURE_WEIGHTS.altitudeHistory,
];

// ─── Safety matrix thresholds ──────────────────────────────────────────────────
export const ALTITUDE_CEILING = 4000; // metres — hard ceiling for at-risk cardio
export const JOINT_DURATION_CEILING = 12; // days — hard ceiling for at-risk joints

/**
 * Only "None" (0) altitude history is a *hard* block.
 *
 * Treating "Basic" (1) as high-risk too — which is also the value a brand-new
 * account is seeded with — hid 24 of the 30 routes from every user the moment
 * they signed up, before they had answered a single onboarding question. Basic
 * experience is now expressed as a graded exponential penalty instead, so those
 * routes rank low rather than disappearing.
 */
const NO_ALTITUDE_HISTORY = 0;

/** How sharply a safety mismatch inflates distance: exp(3 * mismatch). */
const SAFETY_PENALTY_EXPONENT = 3.0;
/** How sharply an age-to-difficulty mismatch inflates distance. */
const AGE_PENALTY_EXPONENT = 1.2;
/** How sharply attempting unfamiliar altitude inflates distance. */
const ALTITUDE_PENALTY_EXPONENT = 1.8;

const DIFFICULTY_LOAD: Record<Difficulty, number> = { Easy: 0, Moderate: 0.5, Hard: 1 };

/**
 * Highest difficulty load each peer bracket is comfortably aligned with.
 *
 *   [0] Gen-Z Explorers 18–23 · [1] Young Professionals 24–29
 *   [2] Active Adventurers 30–35 · [3] Experienced Trekkers 36–41
 *   [4] Seasoned Explorers 42–50+
 *
 * Deliberately flat across the first four. The brackets now span 18–41, and
 * nothing in that range makes a Hard route physically inappropriate — a
 * 38-year-old on Thorong La is unremarkable, and capping them would be the
 * engine inventing a limit the domain does not have. Only the open-ended top
 * bracket carries a ceiling, and even there it is a *ranking* ceiling: it
 * multiplies distance by ~e^0.6 for a Hard route, it does not remove it. The
 * real limits are the safety matrix, which is driven by medical flags rather
 * than by age.
 *
 * Because this table is nearly flat, it is no longer what makes the bracket
 * *mean* something in the cold-start pool. That job belongs to the peer-bracket
 * cohort stage in `coldStartPool` — see `peerBracketAffinity`.
 */
const AGE_DIFFICULTY_CEILING: number[] = [1, 1, 1, 1, 0.5];

// ─── Feed sizing ──────────────────────────────────────────────────────────────

/**
 * How many routes the For You feed returns.
 *
 * The feed is a curated selection, never the catalogue. A brand-new user sees
 * only the handful of routes their onboarding answers and age bracket actually
 * point at; the window widens as the engine learns more about them, because a
 * feed with real signal behind it can afford to explore further.
 */
export const COLD_START_FEED_SIZE = 6;
export const MAX_FEED_SIZE = 14;

/**
 * Likes at which the behavioural layer engages at **full** strength.
 *
 * Two. Not five. The behavioural layer used to need four likes to reach full
 * weight and five before collaborative signal was trusted, which meant a user
 * had to like half a dozen routes before the feed visibly moved — long past the
 * point they had stopped believing it would. Two likes is the smallest sample
 * that can express a *direction* rather than a single data point (two Annapurna
 * likes is a region; one is a coincidence), so it is the earliest honest place
 * to put the trigger.
 *
 * The one like below the trigger is not wasted: `affinityConfidence` ramps
 * linearly, so a single like already reorders the cold-start pool at half
 * weight. Crossing to two flips the feed out of cold start entirely.
 */
export const BEHAVIOURAL_TRIGGER_LIKES = 2;

/** Likes needed before the behavioural layer is trusted at full strength. */
const AFFINITY_SATURATION = BEHAVIOURAL_TRIGGER_LIKES;
/** Likes needed before the collaborative layer is trusted at full strength. */
const CF_SATURATION = BEHAVIOURAL_TRIGGER_LIKES;

/**
 * How much one completed trek counts toward the behavioural trigger, relative
 * to a like.
 *
 * A completed trek is stronger evidence of taste than a like — the user
 * physically went — but it is *historical* and the user is not looking at it
 * right now, so it moves the trigger at half rate rather than firing the
 * behavioural layer on its own. Two completed treks and no likes therefore
 * reach full behavioural weight, but the feed still uses the cold-start pool
 * until a real like arrives (see `coldStart`).
 */
const COMPLETED_TREK_SIGNAL = 0.5;

/**
 * Weight one completed trek carries inside the learned affinity, against the
 * most recent like's weight of 1.
 *
 * High enough that the treks on a user's profile genuinely shape the feed —
 * somebody whose profile is three Everest routes should be shown Khumbu — and
 * below 1 so a fresh like still leads.
 */
const COMPLETED_TREK_WEIGHT = 0.6;

/**
 * Score multiplier for a route the user has already **liked**.
 *
 * The feed's job is the *unexplored* remainder: liking Classic ABC should
 * surface the other Annapurna routes, not keep re-showing Classic ABC at the
 * top because it matches its own affinity profile perfectly. Demoted rather
 * than removed — a like is aspirational, and a route worth liking is still
 * worth seeing again.
 *
 * Completed treks are the opposite case and are not handled here at all: they
 * never reach the scoring loop, having been excluded from the candidate set at
 * the query level. Demotion is for "seen it", removal is for "done it".
 */
const EXPLORED_DEMOTION = 0.55;

// ─── Micro-interaction sentiment ──────────────────────────────────────────────
//
// Every number here is small on purpose. Passive signals are *inferred* intent,
// and inferred intent that can outvote a stated preference produces a feed the
// user cannot steer. These break ties; they do not decide races.

/**
 * Below this mean dwell a view carries no information — it is the card passing
 * under the viewport during a fast scroll, not someone reading it.
 */
const MIN_MEANINGFUL_DWELL_MS = 1200;

/** Ceiling on the boost the longest-dwelt route can earn. */
const PASSIVE_INTEREST_BOOST = 0.15;

/** Per-dismissal penalty for the exact route that was skipped. */
const DISMISS_WEIGHT_DIRECT = 0.06;

/**
 * Per-dismissal penalty bleeding onto the route's region and difficulty tier.
 * A third of the direct weight: skipping one Hard route says something about
 * Hard routes, but much less than it says about that route.
 */
const DISMISS_WEIGHT_CATEGORY = 0.02;

/** Hard floor on how far passive negatives can push a route down. */
const MAX_DISMISS_PENALTY = 0.4;

// ─── Difficulty progression ───────────────────────────────────────────────────

/**
 * How close the average completed tier must be to the next rung before it
 * unlocks. 0.34 means roughly a third of the way past the current tier — enough
 * that a couple of harder routes count as progress, not so little that one does.
 */
const PROGRESSION_UNLOCK_MARGIN = 0.34;

/** How many of the unlocked tier's gentlest routes are promoted. */
const PROGRESSION_INTRO_COUNT = 3;

/** Boost applied to those introductory routes. */
const PROGRESSION_BOOST = 0.2;

/**
 * The specific-inventory floor for cold start. Below this many routes from the
 * form ∩ bracket intersection, the feed switches to an explicit 50/50 blend of
 * peer-liked and trending rather than leaning on either alone.
 */
const COLD_START_BLEND_FLOOR = 5;

/**
 * Share of a user's recency-weighted likes a region must hold before the feed
 * treats it as one the user is actively into. A third is low enough that two
 * Everest likes out of five register immediately, and high enough that one
 * stray like does not relabel the whole feed.
 *
 * Note this is a threshold on *each* region independently, not a winner-take-all
 * comparison: liking two Annapurna and two Everest routes puts both at 0.5 and
 * both are surfaced. That multi-region case is the normal one, not an edge case.
 */
const REGION_DOMINANCE_THRESHOLD = 1 / 3;

/** How many regions the feed will actively reserve slots for at once. */
const MAX_AFFINE_REGIONS = 3;

/**
 * Ceiling on how much of the feed one region may occupy.
 *
 * The feed has to react to what the user likes without collapsing into a single
 * region — somebody who likes two Everest routes wants more Everest, not an
 * exclusively Everest feed with no route left to discover.
 */
const MAX_REGION_SHARE = 0.5;

/**
 * Ceiling on the combined share of the feed all affine regions may occupy.
 *
 * Looser than the per-region cap so a genuine two-region taste (Annapurna +
 * Everest) can hold most of the feed, while still leaving room for the
 * attribute and collaborative layers to introduce something new.
 */
const MAX_COMBINED_REGION_SHARE = 0.75;

// ─── Behavioural sub-weights (must sum to 1) ──────────────────────────────────

/**
 * How the six behavioural dimensions divide the affinity score.
 *
 * Region leads because it is the adaptation a user actually perceives — the
 * requirement is that liking Annapurna visibly surfaces more Annapurna, not
 * that it shifts the ranking by a rounding error. Price and duration come next
 * because they are the two axes the user also stated in onboarding, so
 * behaviour agreeing with the form is a strong signal. Semantic keyword overlap
 * is the tie-breaker that connects routes no attribute has in common —
 * "photography", "teahouse", "lake" — across regions.
 */
const AFFINITY_WEIGHTS = {
  region: 0.3,
  price: 0.18,
  duration: 0.18,
  keywords: 0.16,
  difficulty: 0.12,
  priceTier: 0.06,
} as const;

/** Exponential falloff applied to a price/duration gap, per normalised unit. */
const BAND_FALLOFF = 3;

/**
 * How many strongly-shared keyword tokens count as a perfect semantic match.
 *
 * Three. A candidate sharing three of the user's heaviest tokens is as
 * semantically close as the feed needs to care about; beyond that the score
 * saturates rather than letting a keyword-stuffed route outrank everything.
 */
const KEYWORD_SATURATION = 3;

/** How many learned tokens to keep. Enough to be expressive, small on the wire. */
const MAX_TRACKED_KEYWORDS = 16;

/**
 * Tokens that carry no preference signal because nearly every route has them.
 * "Trek", "base" and "camp" appear in a third of the catalogue's titles, so
 * matching on them would make every route look semantically related to every
 * other one.
 */
const KEYWORD_STOPWORDS = new Set([
  'trek', 'treks', 'trekking', 'route', 'trail', 'tour', 'nepal', 'himalaya',
  'himalayan', 'via', 'and', 'the', 'base', 'camp', 'pass', 'valley', 'region',
]);

// ─── Cohort matching (collaborative layer) ────────────────────────────────────

/**
 * How peer similarity is composed.
 *
 * Like-set overlap leads: two users who liked the same routes want the same
 * routes, whatever their forms said. The age bracket is weighted next because
 * the cohort requirement is explicitly age-bracketed — a 22-year-old's taste is
 * evidence for other Gen-Z Explorers. Profile proximity is the smallest term: it
 * is what the attribute layer already measures, so leaning on it here would just
 * re-score L2 through a second route.
 *
 * Note the bracket term is now a *gradient inside an already-filtered set*, not
 * the filter itself. Peers more than `MAX_PEER_BRACKET_GAP` brackets away are
 * excluded outright before scoring — see `computeForYou`.
 */
const COHORT_WEIGHTS = {
  likeOverlap: 0.45,
  ageBracket: 0.3,
  profile: 0.25,
} as const;

/**
 * Similarity multiplier for a peer who is *both* in the user's exact age
 * bracket and shares at least one like. That intersection is the cohort the
 * requirement names, so it is amplified rather than merely counted.
 */
const COHORT_AMPLIFIER = 1.3;

/**
 * Share of the strongest peer-bracket signal a route must hold to count as one
 * the user's own cohort is actually into.
 *
 * A low bar on purpose: this gates a cold-start *ordering* stage, not a
 * recommendation, and a route two peers in your bracket liked is already more
 * relevant to a brand-new account than one nobody comparable has touched.
 */
const PEER_BRACKET_FAVOURITE_THRESHOLD = 0.2;

interface ProfileLike {
  ageGroup: number;
  experienceLevel: number;
  cardioFlag: number;
  jointFlag: number;
  altitudeHistory: number;
}

interface PreferenceLike {
  maxDuration: number;
  maxPrice: number;
  difficulty: 'All' | Difficulty;
}

const DEFAULT_PROFILE: ProfileLike = {
  ageGroup: DEFAULT_AGE_BRACKET,
  experienceLevel: 1,
  cardioFlag: 1,
  jointFlag: 1,
  altitudeHistory: 1,
};

const DEFAULT_PREFERENCES: PreferenceLike = {
  maxDuration: 21,
  maxPrice: 300000,
  difficulty: 'All',
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Read a stored profile into a plain object.
 *
 * `profile` is a Mongoose single-nested subdocument, so object-spreading it
 * yields the document's internals rather than its paths — every field came
 * back undefined and silently fell through to the defaults, which disabled the
 * whole safety filter. Reading each path explicitly is what makes the flags
 * actually reach the evaluation matrix.
 */
function toProfile(stored: any, ageGroup: number): ProfileLike {
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return {
    ageGroup,
    experienceLevel: num(stored?.experienceLevel, DEFAULT_PROFILE.experienceLevel),
    cardioFlag: num(stored?.cardioFlag, DEFAULT_PROFILE.cardioFlag),
    jointFlag: num(stored?.jointFlag, DEFAULT_PROFILE.jointFlag),
    altitudeHistory: num(stored?.altitudeHistory, DEFAULT_PROFILE.altitudeHistory),
  };
}

/** Read the stored onboarding preferences, path by path for the same reason. */
function toPreferences(stored: any): PreferenceLike {
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  const difficulty = stored?.difficulty;

  return {
    maxDuration: num(stored?.maxDuration, DEFAULT_PREFERENCES.maxDuration),
    maxPrice: num(stored?.maxPrice, DEFAULT_PREFERENCES.maxPrice),
    difficulty:
      difficulty === 'Easy' || difficulty === 'Moderate' || difficulty === 'Hard'
        ? difficulty
        : 'All',
  };
}

/**
 * Project a profile (or a route's ideal-trekker label) into the 5D unit vector
 * the KNN layer measures distance in.
 *
 * The bracket dimension divides by `MAX_AGE_BRACKET_INDEX` rather than a
 * hard-coded 3, so widening the bracket set from four bands to five named
 * cohorts rescales this dimension automatically instead of quietly compressing
 * the top bracket into the same slot as the one below it.
 */
function vec(p?: Partial<ProfileLike> | null): number[] {
  const s = p ?? {};
  return [
    clampBracket(s.ageGroup ?? DEFAULT_AGE_BRACKET) / MAX_AGE_BRACKET_INDEX,
    (s.experienceLevel ?? 1) / 3,
    (s.cardioFlag ?? 1) / 1,
    (s.jointFlag ?? 1) / 1,
    (s.altitudeHistory ?? 1) / 3,
  ];
}

function weightedDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += WEIGHT_VECTOR[i] * d * d;
  }
  return Math.sqrt(sum);
}

/** How much cardio/respiratory capacity a route demands, 0-1. */
function cardioDemand(trek: TrekMeta): number {
  const altitudeLoad = clamp01((trek.maxAltitude - 3000) / 3000);
  return clamp01(0.6 * altitudeLoad + 0.4 * DIFFICULTY_LOAD[trek.difficulty]);
}

/** How much joint/mobility strain a route imposes, 0-1. */
function jointStrain(trek: TrekMeta): number {
  const durationLoad = clamp01((trek.durationDays - 5) / 15);
  return clamp01(0.5 * durationLoad + 0.5 * DIFFICULTY_LOAD[trek.difficulty]);
}

/** Normalise a price onto 0-1 across the catalogue's range. */
function priceNorm(priceNPR: number): number {
  const span = PRICE_BOUNDS.max - PRICE_BOUNDS.min || 1;
  return clamp01((priceNPR - PRICE_BOUNDS.min) / span);
}

/** Normalise a duration onto 0-1 across the catalogue's range. */
function durationNorm(days: number): number {
  const span = DURATION_BOUNDS.max - DURATION_BOUNDS.min || 1;
  return clamp01((days - DURATION_BOUNDS.min) / span);
}

/** An inclusive numeric band, as observed across the routes a user engaged with. */
export interface Band {
  min: number;
  max: number;
}

/**
 * How well a value sits inside an observed band, 0-1.
 *
 * Anything *within* the band the user has demonstrated scores a flat 1 — a user
 * who liked a 7-day and a 14-day route is telling us 10 days is fine, and a mean
 * of 10.5 would have scored the 14-day route itself lower than the 10-day one it
 * has never seen. Outside the band the score decays exponentially with the
 * normalised distance to the nearest edge, so the tuning is genuinely granular
 * rather than a single centre point.
 */
function bandFit(value: number, band: Band | null, norm: (n: number) => number): number {
  if (!band) return 0;
  const v = norm(value);
  const lo = norm(Math.min(band.min, band.max));
  const hi = norm(Math.max(band.min, band.max));
  const gap = v < lo ? lo - v : v > hi ? v - hi : 0;
  return Math.exp(-BAND_FALLOFF * gap);
}

/** Exponential proximity to a single centre value, 0-1. */
function centreFit(value: number, centre: number, norm: (n: number) => number): number {
  return Math.exp(-BAND_FALLOFF * Math.abs(norm(value) - norm(centre)));
}

/**
 * The semantic tokens a route contributes — its title, its trek family, its
 * route variant and its editorial keywords, lower-cased, de-duplicated and
 * stripped of the words every route shares.
 *
 * Multi-word keywords ("gurung village", "high altitude") are split, so a route
 * tagged "glacial lake" and one tagged "lake" overlap on `lake` rather than
 * being treated as unrelated strings.
 */
function tokenize(trek: TrekMeta): string[] {
  const source = [trek.name, trek.parentName, trek.childRoute, ...(trek.keywords ?? [])].join(' ');
  const tokens: string[] = source.toLowerCase().match(/[a-z]+/g) ?? [];
  return Array.from(
    new Set(tokens.filter(token => token.length > 2 && !KEYWORD_STOPWORDS.has(token)))
  );
}

// ─── Public result types ──────────────────────────────────────────────────────

export interface ScoredTrek {
  trekId: string;
  score: number; // 0-1, higher = more recommended
  attributeFit: number;
  collaborativeBoost: number;
  /** 0-1 — how well the route matches the learned price/duration behaviour. */
  affinityFit: number;
  distance: number;
  filteredOut: boolean;
  filterReason?: string;
  /**
   * One short, human sentence for why this route is in the feed, rendered as a
   * chip on the card. Computed from whichever signal actually dominated the
   * ranking, so it is an explanation rather than a decoration.
   */
  reason?: string;
}

/** What the engine has learned from the user's own interactions. */
export interface BehaviouralAffinity {
  /** True once there is any history for the affinity layer to mean anything. */
  active: boolean;
  /**
   * True once the user has crossed `BEHAVIOURAL_TRIGGER_LIKES` likes, i.e. the
   * behavioural layer is running at full weight and the feed has left cold start.
   */
  behaviouralTriggered: boolean;
  /** How many likes the affinity was learned from. */
  sampleSize: number;
  /** How many completed treks from the user's profile reinforced it. */
  completedSampleSize: number;
  /** Mean price of engaged routes, NPR. Null before any signal. */
  meanPriceNPR: number | null;
  /** Mean duration of engaged routes, days. Null before any signal. */
  meanDurationDays: number | null;
  /** The exact price bounds of the routes the user engaged with, NPR. */
  priceRange: Band | null;
  /** The exact duration bounds of the routes the user engaged with, days. */
  durationRange: Band | null;
  /** The price tier the user gravitates to. */
  dominantPriceTier: PriceTier | null;
  /** Mean difficulty of engaged routes, as a 0-1 load. */
  meanDifficultyLoad: number | null;
  /** Share of the user's engagement per difficulty tier, 0-1 each. */
  difficultyWeights: Record<Difficulty, number>;
  /** The difficulty tier the user gravitates to. */
  dominantDifficulty: Difficulty | null;
  /**
   * Recency-weighted share of the user's likes per Himalayan region, 0-1.
   *
   * This is what makes the feed react the way a reels feed does: like two
   * Everest routes in a row and `Everest` dominates this map within one
   * request, which pulls every other Khumbu route up the ranking immediately.
   */
  regionWeights: Record<string, number>;
  /** The single strongest region, if any clears the dominance threshold. */
  dominantRegion: string | null;
  /**
   * *Every* region above the dominance threshold, strongest first.
   *
   * The multi-region case is first-class: Annapurna + Everest both get reserved
   * slots rather than the weaker one losing a winner-take-all comparison.
   */
  affineRegions: string[];
  /**
   * The heaviest title/keyword tokens, each normalised to 0-1 against the
   * strongest. This is the semantic axis — it links routes that share no
   * region, price or difficulty but do share what they are *about*.
   */
  keywordWeights: Record<string, number>;
  /** Short human-readable summary the feed can surface, e.g. "Budget · ~7 days". */
  labels: string[];
}

/** The sliding weights actually used for this request. */
export interface EngineWeights {
  attributeFit: number;
  popularity: number;
  affinity: number;
  collaborative: number;
}

/** What the collaborative layer found for this request. */
export interface CohortSummary {
  /**
   * Peers considered — onboarded users with at least one like **that survived
   * the strict bracket filter**, i.e. the user's own bracket or one adjacent to
   * it. This is a count of eligible peers, not of all users.
   */
  candidates: number;
  /** Peers in the user's exact age bracket who also share at least one like. */
  matched: number;
  /** Peers in the same bracket, whether or not their likes overlap. */
  sameBracket: number;
  /** Peers one bracket away — eligible, at half weight. */
  adjacentBracket: number;
  /**
   * Peers dropped for being more than `MAX_PEER_BRACKET_GAP` brackets away.
   * These are the unrealistic age gaps the clustering exists to exclude; they
   * are reported rather than silently discarded.
   */
  excludedByAgeGap: number;
  /** Neighbours actually used, i.e. the top-k by blended similarity. */
  neighbours: number;
  /** Mean similarity of the neighbours used, 0-1. */
  meanSimilarity: number;
}

/** The peer bracket this feed was built for. */
export interface FeedAgeBracket {
  index: number;
  key: AgeBracket['key'];
  label: string;
  rangeLabel: string;
  /** Whether the bracket came from a stored DOB rather than a fallback. */
  derived: boolean;
}

export interface ForYouResult {
  recommended: ScoredTrek[];
  filteredOut: ScoredTrek[];
  order: string[]; // recommended trekIds, best first (what the feed renders)
  totalConsidered: number;
  /** How many routes the feed was trimmed to. */
  feedSize: number;
  /** 0-1 — how much collaborative signal was blended in (0 = pure cold start). */
  collaborativeWeight: number;
  coldStart: boolean;
  /** How many of the cold-start slots were padded from the trending leaderboard. */
  trendingPadding: number;
  /**
   * How many of the cold-start slots came from the strict peer-bracket cohort —
   * routes the user's own age bracket is actually into.
   */
  peerBracketSlots: number;
  /**
   * Routes withheld because the user has already completed them.
   *
   * Unconditional: there is no thin-catalogue backfill that puts them back. A
   * user who has walked most of the catalogue gets a shorter feed, never a
   * repeat of a trek they have finished.
   */
  excludedAsCompleted: number;
  /**
   * Parent families every one of whose sub-routes the user has completed — the
   * only circumstance in which a whole family legitimately vanishes from the
   * feed. Diagnostic: completing one child never removes its siblings, and
   * nothing filters on this.
   */
  completedFamilies: string[];
  /** The peer bracket the feed was clustered on. */
  ageBracket: FeedAgeBracket;
  affinity: BehaviouralAffinity;
  cohort: CohortSummary;
  weights: EngineWeights;
}

export interface TrendingTrek {
  trekId: string;
  likes: number;
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly destinationsService: DestinationsService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Run one of the engine's data sources, falling back to a neutral value if it
   * fails. A degraded layer costs the user some personalisation; a thrown error
   * would cost them the entire feed.
   */
  private async safely<T>(load: () => Promise<T>, fallback: T, label: string): Promise<T> {
    try {
      return await load();
    } catch (error) {
      this.logger.warn(`Recommendation layer "${label}" unavailable: ${(error as Error).message}`);
      return fallback;
    }
  }

  /**
   * The persisted catalogue, with the in-process metadata as a fallback.
   *
   * The destinations collection is seeded on boot and is the source of truth for
   * attributes, but the engine must still rank a feed if Mongo is briefly
   * unreachable — so a read failure degrades to the bundled catalogue rather
   * than returning an empty feed.
   */
  private async catalogue(): Promise<TrekMeta[]> {
    try {
      const docs = await this.destinationsService.catalogue();
      if (docs.length === 0) return TREK_METADATA;
      return docs.map(doc => this.toTrekMeta(doc));
    } catch {
      return TREK_METADATA;
    }
  }

  /**
   * The candidate catalogue: everything the user has **not** completed.
   *
   * The exclusion is pushed down into Mongo (`$nin` on `trekId`) rather than
   * applied to the result of `catalogue()`, so the routes never enter the
   * pipeline at all — nothing scores them, nothing ranks them, and no padding or
   * backfill stage downstream can put them back. That is the difference between
   * "removed from the output" and the absolute exclusion this is required to be.
   *
   * The Mongo-unreachable path still honours the rule: the bundled catalogue is
   * filtered by the same id set, so a degraded read returns fewer candidates
   * rather than a feed that quietly re-offers completed treks.
   */
  private async candidateCatalogue(completedIds: ReadonlySet<string>): Promise<TrekMeta[]> {
    const excluded = Array.from(completedIds);
    if (excluded.length === 0) return this.catalogue();

    try {
      const docs = await this.destinationsService.catalogueExcluding(excluded);
      if (docs.length === 0) return TREK_METADATA.filter(t => !completedIds.has(t.trekId));
      // Belt and braces: the query already excluded these, and the guard costs
      // one pass over 30 rows. An exclusion this load-bearing does not rely on a
      // single mechanism.
      return docs.map(doc => this.toTrekMeta(doc)).filter(t => !completedIds.has(t.trekId));
    } catch {
      return TREK_METADATA.filter(t => !completedIds.has(t.trekId));
    }
  }

  /**
   * Which parent families the user has fully walked.
   *
   * The catalogue nests sub-routes under a parent family: "Gokyo Lakes & EBC",
   * "Everest Base Camp Classic" and the three-passes variants are all children
   * of the same Everest parent. Completing one of them is a statement about
   * that route, not about the family — the siblings are still unwalked
   * destinations and must keep appearing in the feed.
   *
   * A family is only "completed" when *every* child id is in the completed set,
   * and even then nothing is filtered on that basis: the family disappears on
   * its own because each of its routes was individually excluded. Reporting it
   * separately is what makes the distinction checkable from the outside instead
   * of being an assumption about how the id filter happens to behave.
   *
   * Routes with no `parentName` are standalone and are their own family.
   */
  private familyCompletion(
    catalogue: readonly TrekMeta[],
    completedIds: ReadonlySet<string>
  ): string[] {
    if (completedIds.size === 0) return [];

    const families = new Map<string, { total: number; completed: number }>();
    for (const trek of catalogue) {
      const family = trek.parentName || trek.name;
      const row = families.get(family) ?? { total: 0, completed: 0 };
      row.total += 1;
      if (completedIds.has(trek.trekId)) row.completed += 1;
      families.set(family, row);
    }

    return Array.from(families.entries())
      .filter(([, row]) => row.total > 0 && row.completed === row.total)
      .map(([family]) => family)
      .sort();
  }

  /** Project one persisted destination document onto the engine's trek shape. */
  private toTrekMeta(doc: DestinationDocument): TrekMeta {
    const maxAltitude = doc.maxAltitude ?? doc.altitude ?? 0;
    const difficulty = (doc.difficulty as Difficulty) ?? difficultyFor(maxAltitude);
    return {
      trekId: doc.trekId,
      name: doc.name,
      parentName: doc.parentName ?? '',
      childRoute: doc.childRoute ?? '',
      region: doc.region ?? '',
      location: doc.location ?? '',
      maxAltitude,
      difficulty,
      durationDays: doc.durationDays ?? 0,
      priceNPR: doc.priceNPR ?? 0,
      priceTier: (doc.priceTier as PriceTier) ?? priceTierFor(doc.priceNPR ?? 0),
      keywords: doc.keywords ?? [],
      knnProfile: doc.knnProfile ?? {
        ageGroup: idealBracketFor(difficulty),
        experienceLevel: difficulty === 'Easy' ? 0 : difficulty === 'Moderate' ? 2 : 3,
        cardioFlag: 1,
        jointFlag: 1,
        altitudeHistory: altitudeHistoryFor(maxAltitude),
      },
    };
  }

  /**
   * Popularity layer — the trending leaderboard, aggregated from the likes
   * collection in MongoDB.
   *
   * Strictly organic: the only input is the real count of unique user likes.
   * There is no seed popularity to fall back on, so on a freshly seeded
   * database every route sits at zero and the board is ordered by `trekId`
   * until somebody actually likes something. That is deliberate — a fabricated
   * head start would make the leaderboard a lie on day one.
   *
   * Cached for a few seconds and invalidated write-through on every like, so
   * the aggregation runs once per burst of traffic rather than once per reader
   * while still reflecting a user's own tap immediately.
   */
  async getTrending(limit = 3): Promise<TrendingTrek[]> {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 30) : 3;

    return this.cache.wrap(
      `trending:${n}`,
      CACHE_TTL.TRENDING,
      [CacheTag.LIKES, CacheTag.DESTINATIONS],
      async () => {
        const [counts, treks] = await Promise.all([
          // A failed aggregation degrades to an all-zero board rather than
          // erroring — this endpoint also backs the public landing page.
          this.safely(() => this.usersService.getAllLikeCounts(), {}, 'trendingCounts'),
          this.catalogue(),
        ]);

        return treks
          .map(t => ({ trekId: t.trekId, likes: counts[t.trekId] ?? 0 }))
          .sort((a, b) => b.likes - a.likes || a.trekId.localeCompare(b.trekId))
          .slice(0, n);
      }
    );
  }

  // ─── Safety matrix ──────────────────────────────────────────────────────────

  /**
   * Hard boundaries. These are not scores — a blocked trek never reaches the
   * feed no matter how well it fits on every other dimension.
   */
  private safetyCheck(profile: ProfileLike, trek: TrekMeta): { blocked: boolean; reason?: string } {
    const poorCardio = profile.cardioFlag === 0;
    const poorJoints = profile.jointFlag === 0;
    const noAltitude = profile.altitudeHistory === NO_ALTITUDE_HISTORY;

    if ((poorCardio || noAltitude) && trek.maxAltitude > ALTITUDE_CEILING) {
      return { blocked: true, reason: 'Exceeds safe altitude for your health profile' };
    }
    if (poorCardio && trek.difficulty === 'Hard') {
      return { blocked: true, reason: 'Too demanding for your cardio profile' };
    }
    if (poorJoints && trek.difficulty === 'Hard') {
      return { blocked: true, reason: 'Too demanding for your joint profile' };
    }
    if (poorJoints && trek.durationDays > JOINT_DURATION_CEILING) {
      return { blocked: true, reason: 'Longer than is safe for your joint profile' };
    }
    return { blocked: false };
  }

  /**
   * Exponential distance multiplier for the treks that survive the hard rules.
   * A poor cardio or joint flag against a demanding route multiplies distance
   * by up to e^3 (~20x), so a mismatched risk profile sinks to the bottom of
   * the ranking rather than merely ranking a little lower. Age-to-difficulty
   * overreach applies a second, gentler exponential on top.
   */
  private riskMultiplier(profile: ProfileLike, trek: TrekMeta): number {
    const cardioMismatch = (1 - profile.cardioFlag) * cardioDemand(trek);
    const jointMismatch = (1 - profile.jointFlag) * jointStrain(trek);
    const medical = Math.exp(SAFETY_PENALTY_EXPONENT * (cardioMismatch + jointMismatch));

    const ceiling = AGE_DIFFICULTY_CEILING[profile.ageGroup] ?? 1;
    const ageOverreach = Math.max(0, DIFFICULTY_LOAD[trek.difficulty] - ceiling);
    const age = Math.exp(AGE_PENALTY_EXPONENT * ageOverreach);

    // Attempting far more altitude than you have ever handled is penalised
    // steeply, but not blocked — that is what keeps a "Basic" trekker's feed
    // full while still sinking the 5,000m+ routes to the bottom.
    const altitudeOverreach = Math.max(
      0,
      (trek.knnProfile.altitudeHistory - profile.altitudeHistory) / 3
    );
    const altitude = Math.exp(ALTITUDE_PENALTY_EXPONENT * altitudeOverreach);

    return medical * age * altitude;
  }

  // ─── Behavioural feature learning ───────────────────────────────────────────

  /**
   * Learn the user's taste across every tracked dimension at once.
   *
   * This is the layer that makes the feed adapt. Six dimensions are measured
   * from the same weighted sample, simultaneously rather than in priority order,
   * so a user is never reduced to one axis:
   *
   *   · **Region** — recency-weighted share per Himalayan region, which is what
   *     makes liking Classic ABC surface the rest of Annapurna. Multi-region is
   *     the normal case, not a tie-break.
   *   · **Difficulty tier** — share across Easy / Moderate / Hard, plus the mean
   *     load, so "moderate-leaning" is expressible as well as "always Hard".
   *   · **Price band** — the *exact* min and max the user has engaged with, not
   *     just the mean, so anything inside their demonstrated range scores full.
   *   · **Duration band** — likewise, in days.
   *   · **Semantic tokens** — the title, family, variant and keyword words the
   *     liked routes have in common, normalised to 0-1.
   *   · **Completed treks** — the routes on the user's own profile, folded in at
   *     `COMPLETED_TREK_WEIGHT` so long-term history reinforces every dimension
   *     above without drowning out what they are tapping right now.
   *
   * @param likedTreks     the user's likes, most recent first
   * @param completedTreks the completed treks shown on their profile
   */
  private learnAffinity(likedTreks: TrekMeta[], completedTreks: TrekMeta[]): BehaviouralAffinity {
    const emptyDifficulty: Record<Difficulty, number> = { Easy: 0, Moderate: 0, Hard: 0 };

    if (likedTreks.length === 0 && completedTreks.length === 0) {
      return {
        active: false,
        behaviouralTriggered: false,
        sampleSize: 0,
        completedSampleSize: 0,
        meanPriceNPR: null,
        meanDurationDays: null,
        priceRange: null,
        durationRange: null,
        dominantPriceTier: null,
        meanDifficultyLoad: null,
        difficultyWeights: emptyDifficulty,
        dominantDifficulty: null,
        regionWeights: {},
        dominantRegion: null,
        affineRegions: [],
        keywordWeights: {},
        labels: [],
      };
    }

    // `likedTreks` arrives most-recent-first, so an exponential decay over the
    // index makes the newest likes count roughly twice as much as likes five
    // interactions ago. Completed treks carry a flat, lower weight: their order
    // on the profile is insertion order, which says nothing about recency.
    const DECAY = 0.85;
    const samples: { trek: TrekMeta; weight: number }[] = [
      ...likedTreks.map((trek, index) => ({ trek, weight: Math.pow(DECAY, index) })),
      ...completedTreks.map(trek => ({ trek, weight: COMPLETED_TREK_WEIGHT })),
    ];

    let weightSum = 0;
    let priceSum = 0;
    let durationSum = 0;
    let difficultySum = 0;
    let priceRange: Band | null = null;
    let durationRange: Band | null = null;
    const tierWeight: Record<PriceTier, number> = { budget: 0, mid: 0, premium: 0 };
    const difficultyWeight: Record<Difficulty, number> = { ...emptyDifficulty };
    const regionWeight = new Map<string, number>();
    const tokenWeight = new Map<string, number>();

    for (const { trek, weight } of samples) {
      weightSum += weight;
      priceSum += weight * trek.priceNPR;
      durationSum += weight * trek.durationDays;
      difficultySum += weight * DIFFICULTY_LOAD[trek.difficulty];
      tierWeight[trek.priceTier] += weight;
      difficultyWeight[trek.difficulty] += weight;

      // Bounds are unweighted on purpose: a band is the range the user has
      // actually engaged with, and decaying it would shrink a real preference.
      priceRange = priceRange
        ? { min: Math.min(priceRange.min, trek.priceNPR), max: Math.max(priceRange.max, trek.priceNPR) }
        : { min: trek.priceNPR, max: trek.priceNPR };
      durationRange = durationRange
        ? {
            min: Math.min(durationRange.min, trek.durationDays),
            max: Math.max(durationRange.max, trek.durationDays),
          }
        : { min: trek.durationDays, max: trek.durationDays };

      const region = (trek.region ?? '').trim();
      if (region) regionWeight.set(region, (regionWeight.get(region) ?? 0) + weight);

      for (const token of tokenize(trek)) {
        tokenWeight.set(token, (tokenWeight.get(token) ?? 0) + weight);
      }
    }

    // `weightSum` cannot be 0 here — every sample contributes a positive weight
    // and the empty case returned above — but division is guarded anyway so a
    // future weight of 0 degrades to a neutral profile instead of NaN.
    const totalWeight = weightSum || 1;
    const meanPriceNPR = priceSum / totalWeight;
    const meanDurationDays = durationSum / totalWeight;
    const meanDifficultyLoad = difficultySum / totalWeight;

    const dominantPriceTier = (Object.keys(tierWeight) as PriceTier[]).reduce((best, tier) =>
      tierWeight[tier] > tierWeight[best] ? tier : best
    );

    // Difficulty shares, so "two Easy and one Hard" is legible as a tier
    // preference rather than collapsing to a mid-load average that matches
    // Moderate — a tier the user has never touched.
    const difficultyWeights: Record<Difficulty, number> = {
      Easy: difficultyWeight.Easy / totalWeight,
      Moderate: difficultyWeight.Moderate / totalWeight,
      Hard: difficultyWeight.Hard / totalWeight,
    };
    const dominantDifficulty = (Object.keys(difficultyWeights) as Difficulty[]).reduce(
      (best, tier) => (difficultyWeights[tier] > difficultyWeights[best] ? tier : best)
    );

    // Normalise the region tally into shares of the user's total engagement
    // weight, so `regionWeights` reads directly as "what fraction of this user's
    // recent interest is Everest" and can be used as a score without re-scaling.
    const regionWeights: Record<string, number> = {};
    for (const [region, w] of regionWeight) regionWeights[region] = w / totalWeight;

    // Every region clearing the threshold, strongest first — not just the winner.
    // This is what supports the Annapurna + Everest combination: both are above
    // a third of the signal, so both are treated as active interests.
    const affineRegions = Object.entries(regionWeights)
      .filter(([, share]) => share >= REGION_DOMINANCE_THRESHOLD)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_AFFINE_REGIONS)
      .map(([region]) => region);

    // A single like out of many is not a preference — `dominantRegion` is kept
    // for the summary label and stays null until a region clears the threshold.
    const dominantRegion = affineRegions[0] ?? null;

    // Keep the heaviest tokens, each scaled against the strongest so the
    // semantic score is comparable across users with different history lengths.
    const rankedTokens = Array.from(tokenWeight.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    const topTokenWeight = rankedTokens[0]?.[1] ?? 0;
    const keywordWeights: Record<string, number> = {};
    if (topTokenWeight > 0) {
      for (const [token, w] of rankedTokens.slice(0, MAX_TRACKED_KEYWORDS)) {
        keywordWeights[token] = w / topTokenWeight;
      }
    }

    const tierLabel: Record<PriceTier, string> = {
      budget: 'Budget-friendly',
      mid: 'Mid-range',
      premium: 'Premium',
    };
    const roundedDuration = Math.round(meanDurationDays);
    const labels: string[] = [];
    // Region leads the summary — it is the signal the user notices adapting.
    if (affineRegions.length > 0) labels.push(affineRegions.join(' + '));
    labels.push(
      tierLabel[dominantPriceTier],
      `~${roundedDuration} ${roundedDuration === 1 ? 'day' : 'days'}`
    );
    if (meanDifficultyLoad <= 0.2) labels.push('Easy-leaning');
    else if (meanDifficultyLoad >= 0.8) labels.push('Hard-leaning');

    return {
      active: true,
      behaviouralTriggered: likedTreks.length >= BEHAVIOURAL_TRIGGER_LIKES,
      sampleSize: likedTreks.length,
      completedSampleSize: completedTreks.length,
      meanPriceNPR,
      meanDurationDays,
      priceRange,
      durationRange,
      dominantPriceTier,
      meanDifficultyLoad,
      difficultyWeights,
      dominantDifficulty,
      regionWeights,
      dominantRegion,
      affineRegions,
      keywordWeights,
      labels,
    };
  }

  /**
   * Semantic fit — how much this route's title and keyword vocabulary overlaps
   * the vocabulary of the routes the user engaged with, 0-1.
   *
   * This is the dimension no attribute captures. "Tilicho Lake Circuit" and
   * "Gokyo Lakes" sit in different regions, at different prices and different
   * difficulties, but a user who likes one plainly wants the other; they share
   * `lake`, `glacial` and `photography`. Saturating at
   * `KEYWORD_SATURATION` strong shared tokens keeps a keyword-dense route from
   * outranking everything on vocabulary alone.
   */
  private keywordScore(trek: TrekMeta, affinity: BehaviouralAffinity): number {
    const weights = affinity.keywordWeights;
    if (!weights || Object.keys(weights).length === 0) return 0;

    let matched = 0;
    for (const token of tokenize(trek)) matched += weights[token] ?? 0;
    return clamp01(matched / KEYWORD_SATURATION);
  }

  /**
   * How well a route matches the learned behaviour, 0-1 — the weighted blend of
   * all six tracked dimensions. See `AFFINITY_WEIGHTS` for why they are ordered
   * the way they are.
   */
  private affinityScore(trek: TrekMeta, affinity: BehaviouralAffinity): number {
    if (!affinity.active || affinity.meanPriceNPR === null || affinity.meanDurationDays === null) {
      return 0;
    }

    // Price and duration each combine the *band* the user has demonstrated with
    // proximity to their centre of mass. The band is what makes the tuning
    // granular — a 10-day route is a full match for someone who liked a 7-day
    // and a 14-day route — while the centre term still separates two candidates
    // that both fall inside it.
    const priceFit =
      0.6 * bandFit(trek.priceNPR, affinity.priceRange, priceNorm) +
      0.4 * centreFit(trek.priceNPR, affinity.meanPriceNPR, priceNorm);
    const durationFit =
      0.6 * bandFit(trek.durationDays, affinity.durationRange, durationNorm) +
      0.4 * centreFit(trek.durationDays, affinity.meanDurationDays, durationNorm);

    // Region fit is the user's own engagement share for this route's region,
    // rescaled against their strongest region. It rises the instant they like
    // another route from it — no retraining, no threshold to cross, just the
    // recency-weighted share recomputed per request. Rescaling is what makes the
    // multi-region case work: with Annapurna and Everest at 0.5 each, both score
    // a full 1 here rather than both being halved.
    const region = (trek.region ?? '').trim();
    const shares = Object.values(affinity.regionWeights);
    const topRegionShare = shares.length > 0 ? Math.max(...shares) : 0;
    const regionFit =
      region && topRegionShare > 0
        ? clamp01((affinity.regionWeights[region] ?? 0) / topRegionShare)
        : 0;

    const tierFit = affinity.dominantPriceTier
      ? 1 -
        Math.abs(
          PRICE_TIER_ORDINAL[trek.priceTier] - PRICE_TIER_ORDINAL[affinity.dominantPriceTier]
        ) /
          2
      : 0;

    // Difficulty combines the user's share of *this tier* with proximity to their
    // mean load, so a user who only ever picks Easy and Hard routes is not
    // handed Moderate ones on the strength of an average neither like supports.
    const difficultyShares = Object.values(affinity.difficultyWeights);
    const topDifficultyShare = difficultyShares.length > 0 ? Math.max(...difficultyShares) : 0;
    const tierShareFit =
      topDifficultyShare > 0
        ? clamp01((affinity.difficultyWeights[trek.difficulty] ?? 0) / topDifficultyShare)
        : 0;
    const loadFit =
      affinity.meanDifficultyLoad === null
        ? 0
        : 1 - Math.abs(DIFFICULTY_LOAD[trek.difficulty] - affinity.meanDifficultyLoad);
    const difficultyFit = 0.6 * tierShareFit + 0.4 * loadFit;

    return clamp01(
      AFFINITY_WEIGHTS.region * regionFit +
        AFFINITY_WEIGHTS.price * priceFit +
        AFFINITY_WEIGHTS.duration * durationFit +
        AFFINITY_WEIGHTS.keywords * this.keywordScore(trek, affinity) +
        AFFINITY_WEIGHTS.difficulty * difficultyFit +
        AFFINITY_WEIGHTS.priceTier * tierFit
    );
  }

  /**
   * How closely a route resembles the ones the user already liked, on the
   * ideal-trekker vector. This is the content-based half of "more like what I
   * liked", complementary to the user-to-user collaborative layer.
   */
  private likedSimilarity(trek: TrekMeta, likedTreks: TrekMeta[]): number {
    if (likedTreks.length === 0) return 0;
    let best = 0;
    const trekVec = vec(trek.knnProfile);
    for (const liked of likedTreks) {
      if (liked.trekId === trek.trekId) continue;
      const distance = weightedDistance(trekVec, vec(liked.knnProfile));
      best = Math.max(best, 1 / (1 + distance));
    }
    return best;
  }

  /**
   * Cold-start curation gate.
   *
   * Before any interaction history exists the feed must be driven strictly by
   * the onboarding form and the automated age calculation — so the routes that
   * contradict the stated difficulty, budget or duration preference are pushed
   * out of the initial selection rather than merely ranked lower. Once the user
   * starts liking things their behaviour outranks the form, and the gate relaxes.
   */
  private preferenceGate(trek: TrekMeta, preferences: PreferenceLike): boolean {
    if (preferences.difficulty !== 'All' && trek.difficulty !== preferences.difficulty) {
      return false;
    }
    if (trek.durationDays > preferences.maxDuration) return false;
    if (trek.priceNPR > preferences.maxPrice) return false;
    return true;
  }

  /**
   * Cold-start load gate: is this route within the physical load the user's
   * bracket is aligned with?
   *
   * This deliberately does **not** compare against `trek.knnProfile.ageGroup`.
   * An exact bracket match — which is what this used to do — is structurally
   * unsatisfiable for most brackets, because the catalogue only labels routes
   * with three of the five, so every account outside those three fell straight
   * past the most specific cold-start stage no matter what they had answered.
   * Gating on `AGE_DIFFICULTY_CEILING` uses exactly the same age-to-load table
   * the risk multiplier scores against, so the gate and the ranking cannot
   * disagree about what a bracket is suited to.
   *
   * With the tailored brackets this table is nearly flat (see
   * `AGE_DIFFICULTY_CEILING` for why), so this gate is genuinely permissive for
   * everyone under 42. That is intentional: the bracket's *discriminating* role
   * in cold start is now the peer-cohort stage, and pretending a load limit
   * exists where the domain has none would be a worse way to make the bracket
   * "do something".
   */
  private ageCategoryGate(trek: TrekMeta, ageGroup: number): boolean {
    const ceiling = AGE_DIFFICULTY_CEILING[clampBracket(ageGroup)] ?? 1;
    return DIFFICULTY_LOAD[trek.difficulty] <= ceiling;
  }

  /**
   * Strict peer-bracket affinity — what the user's *own* age cohort likes.
   *
   * This is the collaborative signal expressed as a per-route weight rather than
   * as a neighbour list, and it is what carries the age bracket through cold
   * start. A brand-new account has no likes of its own, so there is nothing for
   * the behavioural or neighbour layers to work with — but the accounts in its
   * bracket have plenty, and "what do people my age actually walk" is real,
   * earned signal rather than a fabricated per-bracket preference table.
   *
   * The clustering rule is hard, not graded: a peer more than
   * `MAX_PEER_BRACKET_GAP` brackets away contributes **nothing**, so a Gen-Z
   * Explorer's cold-start feed can never be shaped by Seasoned Explorers.
   * Adjacent brackets count at half weight (`peerBracketWeight`), which keeps a
   * thin cohort usable without erasing the boundary.
   *
   * @returns each route's cohort weight, normalised 0-1 against the strongest.
   */
  private peerBracketAffinity(
    userBracket: number,
    peers: { userId: string; bracket: number; likes: ReadonlySet<string> }[]
  ): Map<string, number> {
    const raw = new Map<string, number>();

    for (const peer of peers) {
      const weight = peerBracketWeight(Math.abs(peer.bracket - userBracket));
      if (weight === 0) continue;
      for (const trekId of peer.likes) {
        raw.set(trekId, (raw.get(trekId) ?? 0) + weight);
      }
    }

    const max = Math.max(...Array.from(raw.values()), 0);
    if (max <= 0) return new Map();

    const normalised = new Map<string, number>();
    for (const [trekId, weight] of raw) normalised.set(trekId, weight / max);
    return normalised;
  }

  /**
   * Multi-tiered passive sentiment, from `view` and `dismiss` rows.
   *
   * The tiers are deliberately asymmetric in strength. A like is a decision; a
   * long look is a hint; a scroll-past is a weaker hint still, because there
   * are a dozen innocent reasons to scroll past something. So the boost and the
   * penalty here are both small and bounded — enough to break ties between
   * routes the explicit layers rate equally, never enough to overturn them.
   *
   * A dismissal also bleeds onto the route's *category* (region and difficulty),
   * which is the point of tracking it: repeatedly skipping every Hard Everest
   * route should cool the whole cluster, not just the cards that were on screen.
   */
  private readSentiment(
    signals: { trekId: string; type: 'view' | 'dismiss'; count: number; dwellMs: number }[],
    trekById: Map<string, TrekMeta>,
  ): { multiplierFor: (trek: TrekMeta) => number; active: boolean } {
    const inert = { multiplierFor: () => 1, active: false };
    if (!Array.isArray(signals) || signals.length === 0) return inert;

    const dwellByTrek = new Map<string, number>();
    const dismissByTrek = new Map<string, number>();
    const dismissByRegion = new Map<string, number>();
    const dismissByDifficulty = new Map<string, number>();

    for (const s of signals) {
      if (s.type === 'view') {
        // Mean dwell per view, so ten glances don't outweigh one long read.
        const mean = s.count > 0 ? s.dwellMs / s.count : 0;
        if (mean > 0) dwellByTrek.set(s.trekId, mean);
        continue;
      }
      dismissByTrek.set(s.trekId, s.count);
      const meta = trekById.get(s.trekId);
      if (!meta) continue;
      dismissByRegion.set(meta.region, (dismissByRegion.get(meta.region) ?? 0) + s.count);
      dismissByDifficulty.set(
        meta.difficulty,
        (dismissByDifficulty.get(meta.difficulty) ?? 0) + s.count,
      );
    }

    if (dwellByTrek.size === 0 && dismissByTrek.size === 0) return inert;

    const maxDwell = Math.max(...Array.from(dwellByTrek.values()), 1);

    return {
      active: true,
      multiplierFor: (trek: TrekMeta) => {
        // Passive interest: 0-1 of the strongest dwell seen, scaled to the cap.
        const dwell = dwellByTrek.get(trek.trekId) ?? 0;
        const interest = dwell >= MIN_MEANINGFUL_DWELL_MS ? dwell / maxDwell : 0;
        const boost = 1 + interest * PASSIVE_INTEREST_BOOST;

        // Negative: the route itself, then a weaker echo from its category.
        const direct = dismissByTrek.get(trek.trekId) ?? 0;
        const regional = dismissByRegion.get(trek.region) ?? 0;
        const byTier = dismissByDifficulty.get(trek.difficulty) ?? 0;
        const negative = Math.min(
          MAX_DISMISS_PENALTY,
          direct * DISMISS_WEIGHT_DIRECT +
            regional * DISMISS_WEIGHT_CATEGORY +
            byTier * DISMISS_WEIGHT_CATEGORY,
        );

        return boost * (1 - negative);
      },
    };
  }

  /**
   * Dynamic difficulty progression.
   *
   * Reads the average tier of what the user has actually finished and gently
   * promotes the *next* tier up — the introductory rungs of it, not its hardest
   * routes. Someone who has completed four Moderate treks is ready to be shown
   * an accessible Hard one; showing them Makalu Sherpani Col because it is also
   * Hard would be the same mistake in the opposite direction.
   *
   * Routes at or below the tier already cleared are left alone rather than
   * penalised: consolidating at your current level is a legitimate choice, and
   * the safety matrix stays the only thing that removes a route outright.
   */
  private difficultyProgression(completedTreks: TrekMeta[]): {
    multiplierFor: (trek: TrekMeta) => number;
    averageTier: number;
    nextTier: string | null;
    introductory: ReadonlySet<string>;
  } {
    const idle = {
      multiplierFor: () => 1,
      averageTier: 0,
      nextTier: null,
      introductory: new Set<string>() as ReadonlySet<string>,
    };
    if (completedTreks.length === 0) return idle;

    const ordinal: Record<string, number> = { Easy: 0, Moderate: 1, Hard: 2 };
    const tiers = completedTreks.map(t => ordinal[t.difficulty] ?? 0);
    const averageTier = tiers.reduce((a, b) => a + b, 0) / tiers.length;

    // Only unlock the next rung once the average genuinely sits on the current
    // one — a single Hard trek among six Easy ones is not progression.
    const clearedTier = Math.floor(averageTier + PROGRESSION_UNLOCK_MARGIN);
    if (clearedTier >= 2) return { ...idle, averageTier, nextTier: null };

    const nextTier = clearedTier + 1 === 1 ? 'Moderate' : 'Hard';

    // The gentlest routes in the unlocked tier, by altitude — the on-ramp.
    const introductory: ReadonlySet<string> = new Set(
      TREK_METADATA.filter(t => t.difficulty === nextTier)
        .sort((a, b) => a.maxAltitude - b.maxAltitude)
        .slice(0, PROGRESSION_INTRO_COUNT)
        .map(t => t.trekId),
    );

    return {
      averageTier,
      nextTier,
      introductory,
      multiplierFor: (trek: TrekMeta) =>
        introductory.has(trek.trekId) ? 1 + PROGRESSION_BOOST : 1,
    };
  }

  /**
   * The one-line "why" shown as a chip on the card.
   *
   * **Region-level, never route-level.** The chip names the parent region the
   * connection runs through — "More from Everest Region" — and never the
   * specific route that caused it. Two reasons:
   *
   *   · Naming the route reads as surveillance. "Because you liked Gokyo Lakes
   *     & EBC" quotes the user's own history back at them; "More from Everest
   *     Region" says the same thing as a recommendation rather than a receipt.
   *   · Sub-route names are long and near-identical ("Gokyo Lakes & EBC",
   *     "Renjo La Three Passes"), so a chip built from one is unreadable at
   *     10pt and truncates to noise. The region is short and is the level the
   *     user actually thinks in.
   *
   * Checked in order of how *specific* the reason is, not how strong the signal
   * was — a region connection the user can recognise beats a numerically larger
   * popularity contribution. The generic reasons only appear when nothing
   * personal applies, which is exactly the cold-start case where they are true.
   *
   * Returns undefined rather than a filler string when nothing meaningful can
   * be said; the card then renders no chip at all, which is better than a chip
   * that explains nothing.
   */
  private explainRecommendation(
    row: ScoredTrek,
    ctx: {
      trekById: Map<string, TrekMeta>;
      completedTreks: TrekMeta[];
      likedTreks: TrekMeta[];
      affinity: BehaviouralAffinity;
      bracketAffinity: ReadonlyMap<string, number>;
      progression: { introductory: ReadonlySet<string>; nextTier: string | null };
      coldStart: boolean;
      cfById: Map<string, number>;
    },
  ): string | undefined {
    const trek = ctx.trekById.get(row.trekId);
    if (!trek) return undefined;

    // The region label the user recognises. Most regions in the catalogue are
    // bare names ("Everest", "Annapurna"), so "Region" is appended unless the
    // name already carries it.
    const regionLabel = /region$/i.test(trek.region) ? trek.region : `${trek.region} Region`;

    // 1. Same region as something they finished — the most concrete link there
    //    is, and the one that most justifies surfacing the rest of the family.
    if (ctx.completedTreks.some(t => t.region === trek.region)) {
      return `More from ${regionLabel}`;
    }

    // 2. Same region as something they liked.
    if (ctx.likedTreks.some(t => t.region === trek.region)) {
      return `More from ${regionLabel}`;
    }

    // 3. The progression on-ramp.
    if (ctx.progression.introductory.has(trek.trekId) && ctx.progression.nextTier) {
      return `A step up to ${ctx.progression.nextTier.toLowerCase()} routes`;
    }

    // 4. The user's own age bracket is into it. Deliberately worded as "peer
    //    group" — the cohort's *name* is never shown anywhere in the UI.
    if ((ctx.bracketAffinity.get(trek.trekId) ?? 0) >= PEER_BRACKET_FAVOURITE_THRESHOLD) {
      return 'Trending in your peer group';
    }

    // 5. Similar people liked it.
    if ((ctx.cfById.get(trek.trekId) ?? 0) > 0) return 'Liked by trekkers like you';

    // 6. Cold start with nothing personal to point at.
    if (ctx.coldStart) return 'Matches your trek preferences';

    return undefined;
  }

  // ─── Personalized feed ──────────────────────────────────────────────────────

  /**
   * Build the For You feed.
   *
   * @param userId the target user
   * @param k      neighbourhood size for the collaborative layer
   * @param limit  hard cap on the returned feed. Defaults to a window that
   *               starts small (cold start) and widens as the engine learns.
   */
  async getForYou(userId: string, k = 5, limit?: number): Promise<ForYouResult> {
    // Per-user, short-lived, and invalidated write-through on any like. The
    // feed re-ranks on every focus and after every heart tap, so without this
    // the full five-source blend ran several times per interaction; with it,
    // the repeat renders are served from memory while the user's own like
    // still busts the entry instantly.
    return this.cache.wrap(
      `foryou:${userId}:${k}:${limit ?? 'auto'}`,
      CACHE_TTL.FEED,
      [CacheTag.LIKES, CacheTag.DESTINATIONS, `user:${userId}`],
      () => this.computeForYou(userId, k, limit)
    );
  }

  private async computeForYou(userId: string, k: number, limit?: number): Promise<ForYouResult> {
    const user = await this.usersService.findById(userId);
    // The bracket ages with the user: always re-derive it from the DOB, falling
    // back to the stored selection only for accounts with no DOB on record.
    const bracketIsDerived = user?.dateOfBirth != null;
    const profile = toProfile(
      user?.profile,
      ageGroupFromDob(user?.dateOfBirth, user?.profile?.ageGroup ?? DEFAULT_AGE_BRACKET)
    );
    const bracket = ageBracketFor(profile.ageGroup);
    const ageBracket: FeedAgeBracket = {
      index: bracket.index,
      key: bracket.key,
      label: bracket.label,
      rangeLabel: bracket.rangeLabel,
      derived: bracketIsDerived,
    };
    const preferences = toPreferences(user?.preferences);
    const userVec = vec(profile);

    /*
      ── The completed treks on the user's profile ────────────────────────────
      Read *before* the catalogue, because it decides which catalogue the engine
      is allowed to score. These ids are excluded from the candidate set at the
      Mongo query level (`$nin`, see `candidateCatalogue`) rather than trimmed
      off the ranking afterwards, so a walked route cannot reach the feed
      through scoring, through cold-start padding, or through any later
      backfill.

      Exclusion is by exact route id, never by family or region — see
      `completedFamilies` below for the parent/child rule that follows from it.
    */
    const completedIds = new Set(
      (Array.isArray(user?.completedTrekIds) ? user!.completedTrekIds : []).filter(
        (id): id is string => typeof id === 'string'
      )
    );

    // Each source degrades independently: a failure in the collaborative corpus
    // must still leave a working attribute-and-safety feed rather than erroring
    // the whole request. `Promise.all` would have failed all six together.
    //
    // Two catalogue reads, and the distinction matters:
    //   · `fullCatalogue` — every route, used purely to *resolve* metadata: the
    //     user's own history, the parent-family hierarchy, the text of the
    //     "why". A completed trek must still be readable as a signal.
    //   · `treks` — the candidate set with completed routes already removed by
    //     Mongo. Everything downstream that scores, ranks, pads or explains a
    //     *recommendation* iterates this one.
    const [fullCatalogue, treks, profiles, interactions, likeCounts, myLikeRows, trending, signals] =
      await Promise.all([
        this.catalogue(),
        this.candidateCatalogue(completedIds),
        this.safely(() => this.usersService.getAllProfiles(), [], 'profiles'),
        this.safely(() => this.usersService.getAllInteractions(), [], 'interactions'),
        this.safely(() => this.usersService.getAllLikeCounts(), {}, 'likeCounts'),
        this.safely(() => this.usersService.getUserLikes(userId), [], 'userLikes'),
        // The exact leaderboard the Explore tab's "Trending Now" renders, reached
        // through the same method and the same cache entry, so the cold-start
        // padding below is literally that list rather than a re-derivation of it.
        this.safely(() => this.getTrending(MAX_FEED_SIZE), [], 'trending'),
        // Passive signals for this user only — they shape their feed alone.
        this.safely(() => this.usersService.getUserSignals(userId), [], 'signals'),
      ]);
    /** Metadata lookup over the *whole* catalogue — resolution, never candidacy. */
    const trekById = new Map(fullCatalogue.map(t => [t.trekId, t]));
    /** How many catalogue routes the completed-trek rule actually withheld. */
    const excludedAsCompleted = Math.max(0, fullCatalogue.length - treks.length);

    // ── The user's own like history, most recent first ────────────────────────
    const likedTreks = myLikeRows
      .map(row => trekById.get(row.trekId))
      .filter((t): t is TrekMeta => !!t);
    const myLikes = new Set(likedTreks.map(t => t.trekId));

    // Long-term history. A route both liked and completed is counted once, as a
    // like, so the stronger recency-weighted signal wins rather than the two
    // stacking into a double vote for the same trek. Resolved against the full
    // catalogue on purpose: these routes are gone from the candidate set, but
    // they are exactly what `learnAffinity` and the progression layer read.
    const completedTreks = Array.from(completedIds)
      .filter(id => !myLikes.has(id))
      .map(id => trekById.get(id))
      .filter((t): t is TrekMeta => !!t);

    /*
      ── Parent family vs. specific sub-route ─────────────────────────────────
      The catalogue is a two-level hierarchy: a parent family ("Everest Base
      Camp Trek") holds several sibling sub-routes ("Gokyo Lakes & EBC", "EBC
      Classic", the three-passes variants). Completing one child must retire
      that child alone.

      Because exclusion is keyed on `trekId`, that is already what happens — the
      siblings are untouched rows in the candidate set. What is computed here is
      the *other* half of the rule: a family only disappears once every one of
      its children has been walked, and this reports which families have reached
      that state. It is diagnostic, not a filter: nothing below consults it to
      remove anything, precisely so a family can never be dropped wholesale.
    */
    const completedFamilies = this.familyCompletion(fullCatalogue, completedIds);

    /** Routes the user has already engaged with — the ones the feed should move past. */
    const explored = new Set<string>([...myLikes, ...completedIds]);
    /** Everything the affinity layer learns from, likes first. */
    const engagedTreks = [...likedTreks, ...completedTreks];

    // ── L3: behavioural feature learning across all six dimensions ────────────
    const affinity = this.learnAffinity(likedTreks, completedTreks);

    // ── Micro-interaction sentiment ───────────────────────────────────────────
    const sentiment = this.readSentiment(signals, trekById);

    // ── Dynamic difficulty progression ────────────────────────────────────────
    const progression = this.difficultyProgression(completedTreks);

    // ── L1 + L2: popularity and attribute fit ─────────────────────────────────
    // Popularity is derived from real likes only. On a database where nobody
    // has liked anything yet this is uniformly zero for every route, and the
    // blend below leans entirely on attribute fit — which is exactly right:
    // there is no popularity signal to report, so none is invented.
    const maxLiveLikes = Math.max(...Object.values(likeCounts), 0);

    const fitById = new Map<string, number>();
    const distanceById = new Map<string, number>();
    const popularityById = new Map<string, number>();
    const suitabilityById = new Map<string, number>();
    const affinityById = new Map<string, number>();

    for (const trek of treks) {
      const base = weightedDistance(userVec, vec(trek.knnProfile));
      const risk = this.riskMultiplier(profile, trek);
      const distance = base * risk;
      const closeness = 1 / (1 + distance); // 0-1, higher = better fit

      // Organic likes only. Zero for everything until a real like exists.
      const popularity =
        maxLiveLikes > 0 ? (likeCounts[trek.trekId] ?? 0) / maxLiveLikes : 0;

      // The behavioural half combines the six-dimension learned taste with
      // similarity to the specific routes already engaged with.
      const behavioural =
        0.7 * this.affinityScore(trek, affinity) + 0.3 * this.likedSimilarity(trek, engagedTreks);

      distanceById.set(trek.trekId, distance);
      fitById.set(trek.trekId, closeness);
      popularityById.set(trek.trekId, popularity);
      affinityById.set(trek.trekId, clamp01(behavioural));
      // Suitability damps the *entire* blended score, so a crowd-pleasing trek
      // cannot be popular-boosted past a route the user is badly matched to.
      suitabilityById.set(trek.trekId, 1 / risk);
    }

    // ── L4: collaborative peer-filtering & strict age-bracket clustering ──────
    //
    // A neighbour is no longer just "whoever's onboarding form looks like mine",
    // and it is no longer *anyone at all*: the bracket is a hard membership rule
    // applied before scoring. Peers more than `MAX_PEER_BRACKET_GAP` tailored
    // brackets away are removed from the corpus outright, so no amount of like
    // overlap can make a Gen-Z Explorer's feed inherit a Seasoned Explorer's
    // taste. Inside the cluster, peers are scored on three things at once: how
    // much of their like set overlaps this user's (Jaccard, so a peer with 200
    // likes does not look similar to everyone by volume), how far their bracket
    // is (0 or 1), and how close their profile vector is. A peer in the
    // *identical* bracket who also shares a like is the cohort the feed is
    // after, so that intersection is amplified rather than merely counted.
    const likesByUser = new Map<string, Set<string>>();
    for (const i of interactions) {
      if (i.type !== 'like') continue;
      if (!likesByUser.has(i.userId)) likesByUser.set(i.userId, new Set());
      likesByUser.get(i.userId)!.add(i.trekId);
    }

    /** Every other onboarded account that has actually liked something. */
    const active = profiles.filter(
      p => p.userId !== userId && p.profile && (likesByUser.get(p.userId)?.size ?? 0) > 0
    );

    // The strict clustering step. `getAllProfiles` already re-derives each peer's
    // bracket from their own DOB, so this compares live brackets rather than
    // whatever was frozen into their document when they signed up.
    let excludedByAgeGap = 0;
    let sameBracketPeers = 0;
    let adjacentBracketPeers = 0;
    const peers: {
      userId: string;
      profile: Partial<ProfileLike>;
      bracket: number;
      gap: number;
      likes: Set<string>;
    }[] = [];

    for (const p of active) {
      const peerProfile = p.profile as Partial<ProfileLike>;
      const peerBracket = clampBracket(peerProfile.ageGroup ?? DEFAULT_AGE_BRACKET);
      const gap = Math.abs(peerBracket - profile.ageGroup);
      if (gap > MAX_PEER_BRACKET_GAP) {
        excludedByAgeGap++;
        continue;
      }
      if (gap === 0) sameBracketPeers++;
      else adjacentBracketPeers++;
      peers.push({
        userId: p.userId,
        profile: peerProfile,
        bracket: peerBracket,
        gap,
        likes: likesByUser.get(p.userId)!,
      });
    }

    // What this user's own cohort is into, independent of the user's own history.
    // This is the signal that gives the bracket teeth at cold start.
    const bracketAffinity = this.peerBracketAffinity(profile.ageGroup, peers);

    let cohortMatched = 0;
    const ranked = peers.map(peer => {
      // Jaccard over the two like sets: shared / union.
      let shared = 0;
      for (const trekId of myLikes) if (peer.likes.has(trekId)) shared++;
      const union = myLikes.size + peer.likes.size - shared;
      const likeOverlap = union > 0 ? shared / union : 0;

      // Identical bracket scores 1, an adjacent one half — the same weighting
      // `peerBracketAffinity` uses, so the two age-aware paths agree on what a
      // bracket's distance is worth.
      const ageFit = peerBracketWeight(peer.gap);

      const distance = weightedDistance(userVec, vec(peer.profile));
      const profileFit = 1 / (1 + distance);

      const inCohort = peer.gap === 0 && shared > 0;
      if (inCohort) cohortMatched++;

      const base =
        COHORT_WEIGHTS.likeOverlap * likeOverlap +
        COHORT_WEIGHTS.ageBracket * ageFit +
        COHORT_WEIGHTS.profile * profileFit;

      return {
        userId: peer.userId,
        likes: peer.likes,
        similarity: clamp01(inCohort ? base * COHORT_AMPLIFIER : base),
      };
    });

    const neighbours = ranked
      .sort((a, b) => b.similarity - a.similarity || a.userId.localeCompare(b.userId))
      .slice(0, k);

    const cfById = new Map<string, number>();
    for (const n of neighbours) {
      for (const trekId of n.likes) {
        // Don't re-recommend what the user has already liked or already walked.
        if (explored.has(trekId)) continue;
        cfById.set(trekId, (cfById.get(trekId) ?? 0) + n.similarity);
      }
    }
    const maxCf = Math.max(...Array.from(cfById.values()), 0);

    const cohort: CohortSummary = {
      candidates: peers.length,
      matched: cohortMatched,
      sameBracket: sameBracketPeers,
      adjacentBracket: adjacentBracketPeers,
      excludedByAgeGap,
      neighbours: neighbours.length,
      meanSimilarity:
        neighbours.length > 0
          ? neighbours.reduce((sum, n) => sum + n.similarity, 0) / neighbours.length
          : 0,
    };

    // ── Hybrid sliding weights ───────────────────────────────────────────────
    // Two independent confidences slide the blend away from the cold start:
    //   · affinityConfidence grows with the user's own like count, and moves
    //     weight onto the behavioural layer first — it needs no other users.
    //   · cfConfidence additionally requires a usable neighbourhood, so the
    //     collaborative layer only takes over once there is a crowd to learn
    //     from. This ordering is what makes the transition smooth rather than
    //     jumping straight from onboarding to strangers' likes.
    //
    // Both saturate at `BEHAVIOURAL_TRIGGER_LIKES` — two likes — so the second
    // heart tap is the one that puts the feed fully under behavioural control.
    // Completed treks count toward the affinity side at half rate, which is what
    // lets a user's profile history shape the ranking before they have liked
    // anything, without pretending a walked route is a live signal.
    const behaviouralSignal = myLikes.size + COMPLETED_TREK_SIGNAL * completedTreks.length;
    const likeConfidence = Math.min(1, behaviouralSignal / AFFINITY_SATURATION);
    const affinityConfidence = affinity.active ? likeConfidence : 0;

    const cfLikeConfidence = Math.min(1, myLikes.size / CF_SATURATION);
    const neighbourConfidence = Math.min(1, neighbours.length / Math.max(1, k));
    // The user's own history *gates* the collaborative layer — it is a factor,
    // not an average term. Averaging the two let a brand-new account inherit
    // collaborative weight purely because other users had likes, which took it
    // out of cold start before it had interacted with anything at all.
    const cfConfidence =
      maxCf > 0 ? cfLikeConfidence * (0.5 + 0.5 * neighbourConfidence) : 0;

    const cfWeight = 0.4 * cfConfidence;
    const affinityWeight = 0.35 * affinityConfidence;
    // Popularity carries the cold start and fades as either learned layer grows.
    const engagement = Math.max(affinityConfidence, cfConfidence);
    const popularityWeight = 0.3 * (1 - engagement);
    const fitWeight = Math.max(0, 1 - cfWeight - affinityWeight - popularityWeight);

    const weights: EngineWeights = {
      attributeFit: fitWeight,
      popularity: popularityWeight,
      affinity: affinityWeight,
      collaborative: cfWeight,
    };

    /**
     * Cold start is defined on **likes**, not on total signal.
     *
     * The onboarding form plus the age bracket governs the pool until the user
     * has crossed the behavioural trigger, which is what makes the two states the
     * requirement describes actually distinct: at 0-1 likes the feed is the
     * declared profile (padded with trending), and from the 2nd like it is
     * learned behaviour over the whole safe catalogue. Completed treks reorder
     * the cold-start pool without ending cold start — they are history, not a
     * statement about what the user wants to see next.
     */
    const coldStart = myLikes.size < BEHAVIOURAL_TRIGGER_LIKES;

    // ── Mathematical layer: the weighted blend ───────────────────────────────
    const combined = treks.map(trek => {
      const attributeFit = fitById.get(trek.trekId) ?? 0;
      const affinityFit = affinityById.get(trek.trekId) ?? 0;
      const collaborativeBoost = maxCf > 0 ? (cfById.get(trek.trekId) ?? 0) / maxCf : 0;
      const blended =
        fitWeight * attributeFit +
        popularityWeight * (popularityById.get(trek.trekId) ?? 0) +
        affinityWeight * affinityFit +
        cfWeight * collaborativeBoost;
      // Already liked or already walked: demoted, so the slot goes to the
      // unexplored routes the affinity actually points at.
      const exploration = explored.has(trek.trekId) ? EXPLORED_DEMOTION : 1;
      // Passive sentiment and progression are *modulators*, never the ranking
      // itself: they nudge an order the explicit signals already established.
      const passive = sentiment.multiplierFor(trek);
      const progressionBoost = progression.multiplierFor(trek);
      const raw =
        blended *
        (suitabilityById.get(trek.trekId) ?? 1) *
        exploration *
        passive *
        progressionBoost;
      return { trek, attributeFit, affinityFit, collaborativeBoost, raw };
    });
    const maxRaw = Math.max(...combined.map(c => c.raw), 1e-6);

    // ── Deterministic safety filter ──────────────────────────────────────────
    const scored: ScoredTrek[] = combined
      .map(c => {
        const safety = this.safetyCheck(profile, c.trek);
        return {
          trekId: c.trek.trekId,
          score: c.raw / maxRaw,
          attributeFit: c.attributeFit,
          collaborativeBoost: c.collaborativeBoost,
          affinityFit: c.affinityFit,
          distance: distanceById.get(c.trek.trekId) ?? 0,
          filteredOut: safety.blocked,
          filterReason: safety.reason,
        };
      })
      .sort((a, b) => b.score - a.score || a.trekId.localeCompare(b.trekId));

    const safeAll = scored.filter(s => !s.filteredOut);
    const filteredOut = scored.filter(s => s.filteredOut);

    // ── Curation: the feed is a selection, never the whole catalogue ──────────
    const window = this.feedWindow(engagement, limit);

    /*
      ── Completed treks are already gone ───────────────────────────────────
      Nothing is trimmed here, because there is nothing left to trim: the
      completed ids never entered `treks`, so they cannot be in `safeAll`.
      Liked routes are only *demoted* (see EXPLORED_DEMOTION) because a like is
      aspirational and worth showing again; a completed trek is finished.

      This used to be a post-scoring filter with a thin-catalogue backfill that
      re-appended completed routes once exclusion could no longer fill the
      window. That backfill is gone. A user who has walked most of the
      catalogue now gets a *shorter* feed — the cold-start peer/trending blend
      below fills what it can from unwalked inventory, and if the remainder is
      genuinely empty the feed is empty. Re-offering a finished trek to pad a
      window is the one outcome the rule does not permit.

      Completed routes stay a first-class *input* throughout: `learnAffinity` is
      fed `completedTreks` above, so having walked two Annapurna routes still
      pulls the rest of Annapurna up the feed. Out of the output, in the signal.
    */
    const safe = safeAll;

    const cold = coldStart
      ? this.coldStartPool(
          safe,
          trekById,
          profile,
          preferences,
          bracketAffinity,
          trending,
          window
        )
      : null;
    const pool = cold ? cold.pool : safe;

    // Guarantee the regions the user is currently into are actually visible.
    const windowed = this.surfaceAffineRegions(
      pool.slice(0, window),
      pool,
      trekById,
      affinity,
      explored
    );

    // Final guarantee. The query-level `$nin` already made this impossible, and
    // the in-memory guard in `candidateCatalogue` made it impossible twice — but
    // this is the last line before the response leaves the service, and "a
    // completed trek is never recommended" is an invariant worth enforcing where
    // it is cheapest to verify and most expensive to get wrong.
    const unwalked = windowed.filter(row => !completedIds.has(row.trekId));

    // Attach the "why" last, once the final order is known — the explanation
    // has to describe the ranking the user is actually looking at.
    const recommended = unwalked.map(row => ({
      ...row,
      reason: this.explainRecommendation(row, {
        trekById,
        completedTreks,
        likedTreks,
        affinity,
        bracketAffinity,
        progression,
        coldStart,
        cfById,
      }),
    }));

    return {
      recommended,
      filteredOut,
      order: recommended.map(s => s.trekId),
      totalConsidered: treks.length,
      feedSize: recommended.length,
      collaborativeWeight: cfWeight,
      coldStart,
      trendingPadding: cold?.padded ?? 0,
      peerBracketSlots: cold?.peerBracketSlots ?? 0,
      excludedAsCompleted,
      completedFamilies,
      ageBracket,
      affinity,
      cohort,
      weights,
    };
  }

  /**
   * Cold-start pool for a brand-new account — the onboarding form intersected
   * with the user's tailored age bracket, then **padded** with the live trending
   * leaderboard until the feed is full.
   *
   * This is a padding cascade, not a fallback cascade. An earlier version stopped
   * at the first stage that yielded anything at all, which meant a user whose
   * stated preferences matched exactly two routes saw a two-item feed and nothing
   * else — the most specific stage "succeeded" and the widening stages never ran.
   * Every stage contributes, in specificity order, and the trending board fills
   * whatever is left:
   *
   *   1. **Form ∩ bracket cohort ∩ bracket load.** The exact intersection the
   *      requirement names: the stated difficulty, budget and duration as a hard
   *      gate, restricted to routes the user's *own* age bracket (or an adjacent
   *      one, at half weight) has actually liked, and within the physical load
   *      that bracket is aligned with. Ordered by cohort strength, so the route
   *      most of the user's peers went for leads the feed.
   *   2. **Form ∩ bracket load.** The stated form, minus the cohort requirement —
   *      this is what a genuinely new deployment falls to, where no peer in the
   *      bracket has liked anything yet.
   *   3. **Bracket cohort alone.** What the user's bracket is into, even where it
   *      falls outside their stated budget or duration. A route half of your
   *      cohort liked is better evidence than a route nobody comparable touched,
   *      so it outranks the generic widening below — but it comes *after* the
   *      user's own explicit answers, because a form the user filled in
   *      themselves outranks a form-shaped inference about them.
   *   4. **Form alone.** The rest of what they explicitly asked for, including
   *      routes above their bracket's load ceiling. The risk multiplier has
   *      already sunk those in `score`, so they sit at the bottom of the stage.
   *   5. **Trending Now padding.** The Explore leaderboard, in leaderboard order,
   *      for every slot the specific stages could not fill. This is what
   *      guarantees a full feed for a narrow form (e.g. "Easy only, under
   *      ₹10,000") on a database with no cohort history to draw on.
   *   6. **Safety-filtered remainder.** A final backstop so the pool is a
   *      complete ordering of everything the user is allowed to see — the window
   *      only ever slices the top of it, so this costs nothing when the stages
   *      above already filled the window.
   *
   * Every stage draws from `safe`, so the safety matrix is never bypassed, and
   * every stage preserves the incoming score order within itself except the two
   * cohort stages, which order by cohort strength first.
   *
   * @param bracketAffinity normalised peer-bracket weight per trek, from
   *                        `peerBracketAffinity` — already strictly clustered.
   * @returns the ordered pool, how many of the first `window` slots came from the
   *          trending board rather than from the user's profile or cohort, and
   *          how many came from the cohort.
   */
  private coldStartPool(
    safe: ScoredTrek[],
    trekById: Map<string, TrekMeta>,
    profile: ProfileLike,
    preferences: PreferenceLike,
    bracketAffinity: ReadonlyMap<string, number>,
    trending: TrendingTrek[],
    window: number
  ): { pool: ScoredTrek[]; padded: number; peerBracketSlots: number } {
    const trekFor = (s: ScoredTrek) => trekById.get(s.trekId) ?? null;
    const matchesPreferences = (s: ScoredTrek) => {
      const trek = trekFor(s);
      return trek ? this.preferenceGate(trek, preferences) : false;
    };
    const matchesAgeCategory = (s: ScoredTrek) => {
      const trek = trekFor(s);
      return trek ? this.ageCategoryGate(trek, profile.ageGroup) : false;
    };
    const cohortWeight = (s: ScoredTrek) => bracketAffinity.get(s.trekId) ?? 0;
    const isCohortFavourite = (s: ScoredTrek) =>
      cohortWeight(s) >= PEER_BRACKET_FAVOURITE_THRESHOLD;
    /** Strongest cohort signal first, score breaking ties. */
    const byCohort = (rows: ScoredTrek[]) =>
      [...rows].sort(
        (a, b) =>
          cohortWeight(b) - cohortWeight(a) ||
          b.score - a.score ||
          a.trekId.localeCompare(b.trekId)
      );

    const preferred = safe.filter(matchesPreferences);
    /** The stated form, narrowed to the load the user's bracket is aligned with. */
    const preferredForBracket = preferred.filter(matchesAgeCategory);
    const cohortFavourites = safe.filter(isCohortFavourite);

    const pool: ScoredTrek[] = [];
    const seen = new Set<string>();
    const append = (rows: ScoredTrek[]) => {
      for (const row of rows) {
        if (seen.has(row.trekId)) continue;
        seen.add(row.trekId);
        pool.push(row);
      }
    };

    // Stages 1-4, most specific first.
    append(byCohort(preferredForBracket.filter(isCohortFavourite)));
    append(preferredForBracket);
    append(byCohort(cohortFavourites));
    append(preferred);

    /** How many of the visible slots the profile/cohort stages actually filled. */
    const profileDriven = Math.min(pool.length, window);
    /** …and how many of those the cohort put there. */
    const peerBracketSlots = pool
      .slice(0, profileDriven)
      .filter(isCohortFavourite).length;

    const safeById = new Map(safe.map(s => [s.trekId, s]));
    const trendingRows = trending
      .map(entry => safeById.get(entry.trekId))
      .filter((r): r is ScoredTrek => !!r);

    /*
      Stage 5 — thin-inventory blend.

      When the specific stages produced fewer than `COLD_START_BLEND_FLOOR`
      routes, the user's stated form barely intersects the catalogue and
      whichever single source fills the rest effectively *becomes* the feed.
      Padding purely from trending would hand a brand-new account the same
      global leaderboard everyone else sees; padding purely from the cohort
      would over-fit a handful of peers.

      So the remainder is interleaved 50/50: one route the user's own age
      bracket actually likes, then one from the live Explore leaderboard, and
      repeat. Both tiers are represented from the very first padded slot rather
      than one being exhausted before the other starts.
    */
    if (profileDriven < COLD_START_BLEND_FLOOR) {
      const peerLiked = byCohort(cohortFavourites).filter(s => !seen.has(s.trekId));
      const global = trendingRows.filter(s => !seen.has(s.trekId));

      for (let i = 0; i < Math.max(peerLiked.length, global.length); i++) {
        if (i < peerLiked.length) append([peerLiked[i]]);
        if (i < global.length) append([global[i]]);
        if (pool.length >= window) break;
      }
    }

    // Stage 6 — pad from the trending leaderboard, in leaderboard order. Only
    // routes that survived the safety matrix are eligible, so a trending route
    // that is unsafe for this user still never appears.
    append(trendingRows);

    // Stage 7 — backstop. `safe` already carries popularity in its score.
    append(safe);

    return {
      pool,
      padded: Math.max(0, Math.min(pool.length, window) - profileDriven),
      peerBracketSlots,
    };
  }

  /**
   * Guarantee every region the user is actively into is visible in the feed —
   * and that what shows up from those regions is what they have *not* seen yet.
   *
   * The blended score alone was not enough to deliver the behaviour the feed is
   * supposed to have. A user who likes two Everest routes has told us plainly
   * what they want — but Everest routes are high, hard and long, so the safety
   * matrix's exponential risk multiplier sinks them for anyone whose altitude
   * history is only "Basic". The result was a feed that registered `Everest` as
   * the dominant region, said so on screen, and then showed nothing from it.
   *
   * Reserving slots resolves that without weakening the safety rules. The
   * substitutes are drawn from `pool`, which is already safety-filtered, so
   * nothing hard-blocked can appear — this only reorders routes the user is
   * permitted to see, promoting the best-scoring ones from the regions they are
   * actively engaging with. It is the "topic block" behaviour a reels-style feed
   * has, rather than a pure global ranking.
   *
   * Two properties matter beyond the single-region version this replaces:
   *
   *   · **Multi-region.** Every region in `affinity.affineRegions` gets its own
   *     reservation, sized by its share. Liking Annapurna *and* Everest fills
   *     the feed with both, in proportion, instead of the runner-up losing a
   *     winner-take-all comparison and disappearing.
   *   · **Unexplored first.** Within a region, routes the user has not liked or
   *     completed are promoted ahead of ones they have. "Liked Classic ABC →
   *     show me the other Annapurna routes" is the literal requirement, and
   *     re-promoting Classic ABC into its own reserved slot would defeat it.
   *
   * Substitution happens from the *bottom* of the window, so the single
   * best-scoring overall route is never displaced.
   */
  private surfaceAffineRegions(
    window: ScoredTrek[],
    pool: ScoredTrek[],
    trekById: Map<string, TrekMeta>,
    affinity: BehaviouralAffinity,
    explored: ReadonlySet<string>
  ): ScoredTrek[] {
    const regions = affinity.affineRegions;
    if (regions.length === 0 || window.length === 0) return window;

    const regionOf = (s: ScoredTrek) => (trekById.get(s.trekId)?.region ?? '').trim();
    const result = [...window];
    const shown = new Set(result.map(s => s.trekId));

    // Total reservation across all affine regions, so a two-region taste cannot
    // squeeze discovery out of the feed entirely.
    const combinedCeiling = Math.floor(result.length * MAX_COMBINED_REGION_SHARE);
    let reservedTotal = result.filter(s => regions.includes(regionOf(s))).length;

    for (const region of regions) {
      if (reservedTotal >= combinedCeiling) break;

      // How many slots this region deserves: its share of the user's recent
      // engagement, capped per region so one region cannot take over the feed.
      const share = affinity.regionWeights[region] ?? 0;
      const target = Math.min(
        Math.max(1, Math.round(share * result.length)),
        Math.max(1, Math.floor(result.length * MAX_REGION_SHARE)),
        combinedCeiling - reservedTotal + result.filter(s => regionOf(s) === region).length
      );

      const present = result.filter(s => regionOf(s) === region).length;
      if (present >= target) continue;

      // Unexplored routes from this region first, then already-engaged ones as a
      // last resort — each group keeping its score order.
      const inRegion = pool.filter(s => regionOf(s) === region && !shown.has(s.trekId));
      const candidates = [
        ...inRegion.filter(s => !explored.has(s.trekId)),
        ...inRegion.filter(s => explored.has(s.trekId)),
      ];
      if (candidates.length === 0) continue;

      let needed = target - present;

      // Walk backwards, replacing the weakest entries that no affine region
      // needs. Index 0 is never touched: the top of the feed stays on merit.
      for (let i = result.length - 1; i > 0 && needed > 0 && candidates.length > 0; i--) {
        const current = regionOf(result[i]);
        if (regions.includes(current)) continue; // already serving a reservation
        const promoted = candidates.shift()!;
        shown.delete(result[i].trekId);
        shown.add(promoted.trekId);
        result[i] = promoted;
        needed--;
        reservedTotal++;
        if (reservedTotal >= combinedCeiling) break;
      }
    }

    // Re-sort so the promoted routes sit at their own merit, not at the bottom.
    return result.sort((a, b) => b.score - a.score || a.trekId.localeCompare(b.trekId));
  }

  /**
   * How many routes to surface. Starts at the cold-start size and widens toward
   * `MAX_FEED_SIZE` as the engine gathers signal, so the feed never shows the
   * entire catalogue but does open up for an engaged user. An explicit `limit`
   * from the caller is honoured, clamped to the same ceiling.
   */
  private feedWindow(engagement: number, limit?: number): number {
    if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
      return Math.min(Math.floor(limit), MAX_FEED_SIZE);
    }
    const span = MAX_FEED_SIZE - COLD_START_FEED_SIZE;
    return COLD_START_FEED_SIZE + Math.round(clamp01(engagement) * span);
  }
}
