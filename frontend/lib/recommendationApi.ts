/**
 * recommendationApi.ts
 *
 * Thin client for the backend dual-layer recommendation engine
 * (NestJS `/recommendations`). The backend returns trek IDs in ranked order
 * (KNN + collaborative filtering) with the deterministic safety filter already
 * applied; we map those IDs back onto the local trek catalogue for rendering.
 */

import { DESTINATIONS, Destination } from '@/data/destinations';
import { apiFetch, getStoredAccessToken } from '@/lib/authTokens';

const TREK_BY_ID = new Map(DESTINATIONS.map(d => [d.id, d]));

/**
 * What the engine has learned from the user's own likes — the price tier and
 * trip length they gravitate to. Drives the live "learning from your likes"
 * chips on the For You feed.
 */
export interface FeedAffinity {
  active: boolean;
  /**
   * True once the user has crossed the backend's 2-like behavioural trigger, so
   * the ranking is driven by learned behaviour rather than the onboarding form.
   */
  behaviouralTriggered: boolean;
  sampleSize: number;
  /** How many completed treks from the profile reinforced the affinity. */
  completedSampleSize: number;
  meanPriceNPR: number | null;
  meanDurationDays: number | null;
  dominantPriceTier: 'budget' | 'mid' | 'premium' | null;
  /**
   * The Himalayan region the user is currently gravitating to, if any. This is
   * the signal that makes the feed visibly adapt — liking Everest routes pulls
   * other Khumbu routes to the top on the very next fetch.
   */
  dominantRegion: string | null;
  /**
   * *Every* region the engine is actively surfacing, strongest first. Liking
   * Annapurna and Everest routes puts both here — the feed reserves slots for
   * each rather than picking a single winner.
   */
  affineRegions: string[];
  /** The difficulty tier the user's engagement clusters on. */
  dominantDifficulty: 'Easy' | 'Moderate' | 'Hard' | null;
  labels: string[];
}

/** The tailored peer bracket the backend clustered this feed on. */
export interface FeedAgeBracket {
  index: number;
  key: string;
  /** Cohort name, e.g. "Young Professionals". */
  label: string;
  /** Range as the preference form shows it, e.g. "24 – 29". */
  rangeLabel: string;
  /** True when the bracket came from a stored date of birth. */
  derived: boolean;
}

/** What the strict age-bracket clustering found among other users. */
export interface FeedPeerCohort {
  /** Peers eligible after the strict bracket filter — same or adjacent bracket. */
  candidates: number;
  /** Eligible peers in the user's exact bracket. */
  sameBracket: number;
  /** Eligible peers one bracket away, counted at half weight. */
  adjacentBracket: number;
  /** Peers dropped for sitting more than one bracket away. */
  excludedByAgeGap: number;
  /** Peers in the exact bracket who also share at least one like. */
  matched: number;
}

export interface ForYouFeed {
  /** Recommended treks in personalized order (safety-filtered treks excluded). */
  recommended: Destination[];
  /** Treks hard-filtered out by the safety matrix, with the reason. */
  filteredOut: { trek: Destination; reason?: string }[];
  /** True while the ranking is driven purely by the onboarding profile. */
  coldStart: boolean;
  /** Behavioural signal the engine has learned so far. */
  affinity: FeedAffinity;
  /** 0-1 — how much collaborative signal was blended into this ranking. */
  collaborativeWeight: number;
  /**
   * The bracket the feed was built for, as the *server* resolved it. Null only
   * for a payload from a backend that predates the tailored brackets.
   */
  ageBracket: FeedAgeBracket | null;
  /** The strictly-clustered peer cohort behind this ranking. */
  peerCohort: FeedPeerCohort;
  /** How many cold-start slots the user's own bracket cohort filled. */
  peerBracketSlots: number;
  /**
   * Routes withheld from the feed because the user has already completed them.
   *
   * Unconditional — the backend excludes these ids from the candidate set before
   * ranking and never backfills them, so a completed trek cannot appear however
   * thin the remaining inventory is.
   */
  excludedAsCompleted: number;
  /**
   * Parent families the user has completed in full — every sub-route walked.
   *
   * The only case where a whole family drops out of the feed. Completing one
   * sub-route (say Gokyo Lakes) retires that route alone and leaves its siblings
   * under the same parent recommendable.
   */
  completedFamilies: string[];
  /**
   * Why each recommended trek is in the feed, keyed by trek id — rendered as a
   * chip on the card. A trek may be absent when nothing meaningful could be
   * said, in which case the card shows no chip rather than a filler one.
   */
  reasons: Record<string, string>;
}

const NO_COHORT: FeedPeerCohort = {
  candidates: 0,
  sameBracket: 0,
  adjacentBracket: 0,
  excludedByAgeGap: 0,
  matched: 0,
};

const NO_AFFINITY: FeedAffinity = {
  active: false,
  behaviouralTriggered: false,
  sampleSize: 0,
  completedSampleSize: 0,
  meanPriceNPR: null,
  meanDurationDays: null,
  dominantPriceTier: null,
  dominantRegion: null,
  affineRegions: [],
  dominantDifficulty: null,
  labels: [],
};

/**
 * Fetch the personalized For You feed for the logged-in user.
 *
 * The backend returns a *curated window* rather than the whole catalogue — the
 * feed size is decided server-side by how much signal the engine has — so this
 * client deliberately does not pad the list out with anything else.
 *
 * Returns null when not authenticated or the backend is unreachable.
 */
export async function fetchForYouFeed(): Promise<ForYouFeed | null> {
  // Cheap pre-check so a signed-out visitor does not issue a request that can
  // only 401. `apiFetch` would still handle it correctly; this just avoids the
  // round trip on the one screen that renders for guests too.
  if (!(await getStoredAccessToken())) return null;

  const { ok, data } = await apiFetch<any>('/recommendations/foryou');
  if (!ok || !data) return null;

  const rawRecommended: { trekId: string; reason?: string }[] =
    Array.isArray(data.recommended) ? data.recommended : [];

  const recommended: Destination[] = rawRecommended
    .map(r => TREK_BY_ID.get(r?.trekId))
    .filter((t: Destination | undefined): t is Destination => !!t);

  /*
    Reasons ride alongside as a lookup rather than reshaping `recommended` into
    tuples. The feed list is keyed and memoized on `Destination`, so changing
    its element type would ripple through the FlatList, its keyExtractor and
    `TrekCard`'s memo comparison for what is ultimately one optional string.
  */
  const reasons: Record<string, string> = {};
  for (const r of rawRecommended) {
    if (r?.trekId && typeof r.reason === 'string' && r.reason) reasons[r.trekId] = r.reason;
  }

  const filteredOut = (Array.isArray(data.filteredOut) ? data.filteredOut : [])
    .map((r: { trekId: string; filterReason?: string }) => {
      const trek = TREK_BY_ID.get(r?.trekId);
      return trek ? { trek, reason: r.filterReason } : null;
    })
    .filter(Boolean) as { trek: Destination; reason?: string }[];

  const affinity: FeedAffinity = data.affinity
    ? {
        active: data.affinity.active === true,
        behaviouralTriggered: data.affinity.behaviouralTriggered === true,
        sampleSize: data.affinity.sampleSize ?? 0,
        completedSampleSize: data.affinity.completedSampleSize ?? 0,
        meanPriceNPR: data.affinity.meanPriceNPR ?? null,
        meanDurationDays: data.affinity.meanDurationDays ?? null,
        dominantPriceTier: data.affinity.dominantPriceTier ?? null,
        dominantRegion:
          typeof data.affinity.dominantRegion === 'string' ? data.affinity.dominantRegion : null,
        affineRegions: Array.isArray(data.affinity.affineRegions)
          ? data.affinity.affineRegions.filter((r: unknown): r is string => typeof r === 'string')
          : [],
        dominantDifficulty: data.affinity.dominantDifficulty ?? null,
        labels: Array.isArray(data.affinity.labels) ? data.affinity.labels : [],
      }
    : NO_AFFINITY;

  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  const raw = data.ageBracket;
  const ageBracket: FeedAgeBracket | null =
    raw && typeof raw.label === 'string'
      ? {
          index: count(raw.index),
          key: typeof raw.key === 'string' ? raw.key : '',
          label: raw.label,
          rangeLabel: typeof raw.rangeLabel === 'string' ? raw.rangeLabel : '',
          derived: raw.derived === true,
        }
      : null;

  const peerCohort: FeedPeerCohort = data.cohort
    ? {
        candidates: count(data.cohort.candidates),
        sameBracket: count(data.cohort.sameBracket),
        adjacentBracket: count(data.cohort.adjacentBracket),
        excludedByAgeGap: count(data.cohort.excludedByAgeGap),
        matched: count(data.cohort.matched),
      }
    : NO_COHORT;

  return {
    recommended,
    filteredOut,
    coldStart: data.coldStart === true,
    affinity,
    collaborativeWeight:
      typeof data.collaborativeWeight === 'number' ? data.collaborativeWeight : 0,
    ageBracket,
    peerCohort,
    peerBracketSlots: count(data.peerBracketSlots),
    excludedAsCompleted: count(data.excludedAsCompleted),
    completedFamilies: Array.isArray(data.completedFamilies)
      ? data.completedFamilies.filter((f: unknown): f is string => typeof f === 'string')
      : [],
    reasons,
  };
}

export interface TrendingTrek {
  trek: Destination;
  likes: number;
}

/** Map a raw `[{trekId, likes}]` payload onto the local trek catalogue. */
function toTrendingTreks(data: unknown): TrendingTrek[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((t: { trekId: string; likes: number }) => {
      const trek = TREK_BY_ID.get(t.trekId);
      return trek ? { trek, likes: t.likes ?? 0 } : null;
    })
    .filter(Boolean) as TrendingTrek[];
}

/**
 * Popularity layer — the trending leaderboard, aggregated from the likes
 * collection. Members only, matching the Explore section's auth guard: an
 * unauthenticated caller gets an empty list rather than a fallback.
 */
export async function fetchTrending(limit = 3): Promise<TrendingTrek[]> {
  if (!(await getStoredAccessToken())) return [];
  const { ok, data } = await apiFetch<unknown>(`/recommendations/trending?limit=${limit}`);
  return ok ? toTrendingTreks(data) : [];
}

/**
 * The same leaderboard without a session, for the public landing page's
 * "Popular Right Now" strip. It hits the identical aggregation as
 * `fetchTrending`, so the marketing page and the signed-in Explore tab always
 * show the same treks in the same order.
 */
export async function fetchPublicTrending(limit = 5): Promise<TrendingTrek[]> {
  const { ok, data } = await apiFetch<unknown>(
    `/recommendations/trending/public?limit=${limit}`,
    { anonymous: true }
  );
  return ok ? toTrendingTreks(data) : [];
}
