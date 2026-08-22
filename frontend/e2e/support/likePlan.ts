/**
 * What each simulated person likes, and why.
 *
 * The suite does not have 500 users tap hearts at random. A random corpus would
 * make every route roughly equally popular and every pair of users roughly
 * equally similar, which is precisely the state in which a recommendation engine
 * cannot be told apart from a shuffle. The interactions have to have *structure*
 * for the engine's output to be evidence of anything.
 *
 * So the population is split into two behavioural segments, each aimed at a
 * different layer of the engine:
 *
 *   · **Diverse** (`diverse`) — likes spread deliberately across regions, price
 *     tiers, difficulty tiers and trip lengths. These users are the ones that
 *     make the *collaborative* layer meaningful: they create overlap between
 *     otherwise unrelated clusters, and they exercise the multi-region case
 *     (Annapurna + Everest both above the dominance threshold) that the feed is
 *     supposed to treat as first-class rather than as a tie-break.
 *
 *   · **Niche** (`niche`) — likes held tightly together: one region, ideally one
 *     parent trek family and its sibling child routes, with prices, durations
 *     and difficulty kept as close as the catalogue allows. These are the users
 *     that make the *content-based* layer measurable. If liking two child routes
 *     of the Annapurna Base Camp Trek does not surface the rest of Annapurna,
 *     these are the profiles that will show it.
 *
 * Both segments like **3 or 4 distinct routes**, comfortably past the engine's
 * 2-like behavioural trigger, so every onboarded account leaves cold start and
 * lands in the adapted state with room to spare.
 *
 * Nothing here talks to the backend. A plan is just a list of routes and the
 * query text to find each one with; the page objects do the tapping.
 */

// The authoritative catalogue — the same attribute table the recommendation
// engine ranks against. Imported rather than mirrored on purpose: a plan built
// from a stale copy of the regions or prices would be testing the engine against
// a catalogue it does not have.
import {
  TREK_METADATA,
  TrekMeta,
  Difficulty,
  PriceTier,
} from '@backend/src/data/trek-metadata';

import { mulberry32, seedFrom, shuffled } from './random';

export type LikeStyle = 'diverse' | 'niche';

/** One route the user is going to like, and how to find it in Explore. */
export interface PlannedLike {
  trekId: string;
  /** The card's display title, for the console log. */
  title: string;
  /**
   * What to type into the Explore search field to narrow the list down to this
   * route. See `searchTokenFor` for why it is not simply the title.
   */
  query: string;
  region: string;
  parentName: string;
  difficulty: Difficulty;
  priceTier: PriceTier;
  durationDays: number;
  priceNPR: number;
}

export interface LikePlan {
  style: LikeStyle;
  likes: PlannedLike[];
  /** One line for the run log, e.g. "niche · Annapurna · Moderate · 3 routes". */
  summary: string;
  /**
   * Set when the user's own health answers left too small a pool to build a
   * realistic plan from, and the safety constraint had to be relaxed. Reported
   * rather than hidden — it means this user's likes are less physically
   * plausible than the rest.
   */
  relaxed?: string;
}

/** Fewest routes a user likes. Above the engine's 2-like trigger by design. */
export const MIN_LIKES = 3;
/** Most routes a user likes. */
export const MAX_LIKES = 4;

/**
 * Share of the population in the `diverse` segment. The rest are `niche`.
 *
 * Tilted slightly toward niche because the content-based claims are the ones
 * with a specific, checkable shape ("liking a child route surfaces its
 * siblings"), and they need enough same-region users to be visible above the
 * collaborative noise the diverse segment deliberately introduces.
 */
const DIVERSE_SHARE = 0.45;

/*
  ── Safety mirror ───────────────────────────────────────────────────────────

  The two hard ceilings from the backend's safety matrix
  (`backend/src/modules/recommendations/recommendations.service.ts`), mirrored
  here for the same reason `lib/ageGroups.ts` mirrors the bracket table: the
  service cannot be imported into a bare Node test runner without dragging in
  the whole Nest container.

  They are used to keep a simulated person's likes *physically plausible for the
  answers they just gave on the onboarding form*. A user who declared a poor
  cardio profile and then likes four 5,500m expeditions is not a realistic
  trekker — and worse, the engine will hard-block every one of those routes from
  their feed, so their entire like history would be evidence about routes they
  can never be shown. Constraining the plan keeps the corpus coherent.

  Note this is a constraint on *what the simulation chooses to like*, not a
  reimplementation of the filter under test. The app itself applies no such
  restriction on Explore: any route can be liked from there, which is exactly
  why the simulation has to impose the plausibility itself.
*/
const ALTITUDE_CEILING = 4000;
const JOINT_DURATION_CEILING = 12;

/** The onboarding answers a plan is built against. */
export interface HealthAnswers {
  cardioFlag: number;
  jointFlag: number;
  altitudeHistory: number;
}

/** Would the engine hard-block this route for someone with these answers? */
function isPlausibleFor(trek: TrekMeta, answers: HealthAnswers): boolean {
  const poorCardio = answers.cardioFlag === 0;
  const poorJoints = answers.jointFlag === 0;
  const noAltitude = answers.altitudeHistory === 0;

  if ((poorCardio || noAltitude) && trek.maxAltitude > ALTITUDE_CEILING) return false;
  if ((poorCardio || poorJoints) && trek.difficulty === 'Hard') return false;
  if (poorJoints && trek.durationDays > JOINT_DURATION_CEILING) return false;
  return true;
}

/*
  ── Search tokens ───────────────────────────────────────────────────────────

  Explore's search bar does not do substring matching — it *parses* the query
  into a structured intent first (see `lib/trekSearch.ts`), and only the words
  left over after that are matched as text. A handful of catalogue titles begin
  with a word that lexicon claims: "Lower Dolpo Jewels" starts with `lower`, an
  upper-bound word, so typing the title asks for "Dolpo Jewels under …" and the
  route it names is not what comes back.

  So the query is the first word of the title that the parser will leave alone —
  "Dolpo" rather than "Lower Dolpo Jewels" — which is also closer to what a
  person actually types. The page object falls back to browsing the unfiltered
  list if the search does not surface the card, so a token that slips through
  this list costs a slower interaction, not a failed run.
*/
const STRUCTURAL_WORDS = new Set([
  // Bound words.
  'under', 'below', 'less', 'lesser', 'max', 'maximum', 'upto', 'within',
  'atmost', 'cheaper', 'shorter', 'lower', 'over', 'above', 'more', 'atleast',
  'min', 'minimum', 'beyond', 'higher', 'longer',
  // Duration words.
  'short', 'quick', 'weekend', 'long', 'extended', 'expedition',
  // Difficulty words.
  'easy', 'beginner', 'novice', 'starter', 'gentle', 'relaxed', 'gradual',
  'moderate', 'intermediate', 'medium', 'average', 'hard', 'difficult',
  'challenging', 'tough', 'strenuous', 'extreme', 'demanding', 'expert',
  'advanced', 'technical',
  // Price words.
  'cheap', 'cheapest', 'budget', 'affordable', 'inexpensive', 'economical',
  'low', 'value', 'midrange', 'reasonable', 'expensive', 'premium', 'luxury',
  'luxurious', 'deluxe', 'splurge',
  // Audience words.
  'family', 'families', 'kids', 'children', 'solo', 'alone', 'group', 'friends',
  // Too generic to narrow anything.
  'the', 'and', 'trek', 'route', 'base', 'camp', 'high',
]);

/** The first word of a title the search parser will treat as plain text. */
export function searchTokenFor(title: string): string {
  const words = title.split(/[^A-Za-z]+/).filter(Boolean);
  const usable = words.find(w => w.length >= 4 && !STRUCTURAL_WORDS.has(w.toLowerCase()));
  // Every catalogue title has at least one usable word today; the fallback keeps
  // a future title that does not from producing an empty query.
  return usable ?? words[0] ?? title;
}

function toPlanned(trek: TrekMeta): PlannedLike {
  return {
    trekId: trek.trekId,
    title: trek.name,
    query: searchTokenFor(trek.name),
    region: trek.region,
    parentName: trek.parentName,
    difficulty: trek.difficulty,
    priceTier: trek.priceTier,
    durationDays: trek.durationDays,
    priceNPR: trek.priceNPR,
  };
}

// ─── Normalisation, for the "tightness" metric the niche segment sorts on ─────

const PRICES = TREK_METADATA.map(t => t.priceNPR);
const DURATIONS = TREK_METADATA.map(t => t.durationDays);
const PRICE_SPAN = Math.max(...PRICES) - Math.min(...PRICES) || 1;
const DURATION_SPAN = Math.max(...DURATIONS) - Math.min(...DURATIONS) || 1;
const DIFFICULTY_LOAD: Record<Difficulty, number> = { Easy: 0, Moderate: 0.5, Hard: 1 };

/**
 * How far apart two routes are on the axes the niche segment holds constant:
 * price, duration and difficulty. Lower is tighter. Region is not a term
 * because the niche candidates have already been narrowed to one region.
 */
function tightness(a: TrekMeta, b: TrekMeta): number {
  return (
    Math.abs(a.priceNPR - b.priceNPR) / PRICE_SPAN +
    Math.abs(a.durationDays - b.durationDays) / DURATION_SPAN +
    Math.abs(DIFFICULTY_LOAD[a.difficulty] - DIFFICULTY_LOAD[b.difficulty])
  );
}

/**
 * A tightly-clustered plan: one region, the anchor's parent family first, then
 * the closest remaining routes in that region.
 *
 * Taking the anchor's siblings before anything else is the point of the segment.
 * The catalogue is a parent-child hierarchy — "Annapurna Base Camp Trek" has
 * "ABC via Ghandruk" and "ABC via Poon Hill" beneath it — and the engine claims
 * that liking one child surfaces the rest of the family and then the rest of the
 * region. A plan that likes a child route *and its sibling* and then stops
 * inside the same region is the shape that makes that claim falsifiable.
 */
function nichePlan(pool: TrekMeta[], rng: () => number, count: number): TrekMeta[] {
  // Prefer a region that can supply the whole plan on its own; among those, the
  // richest, so the tightness sort has something to choose between.
  const byRegion = new Map<string, TrekMeta[]>();
  for (const trek of pool) {
    if (!byRegion.has(trek.region)) byRegion.set(trek.region, []);
    byRegion.get(trek.region)!.push(trek);
  }

  const regions = Array.from(byRegion.keys()).sort();
  const viable = regions.filter(r => byRegion.get(r)!.length >= count);

  /*
    Prefer a region that can supply the whole plan by itself. When the user's
    health answers have shrunk every region below the plan size, fall back to the
    *largest* remaining ones rather than to all of them: the plan will have to
    reach outside the region either way, and starting from the richest one keeps
    the spill as small as the pool allows. Choosing at random there would scatter
    a segment whose entire purpose is being tightly clustered.
  */
  const widest = Math.max(...regions.map(r => byRegion.get(r)!.length));
  const candidateRegions =
    viable.length > 0 ? viable : regions.filter(r => byRegion.get(r)!.length === widest);

  // Deterministic choice, but spread across regions rather than always landing
  // on the largest — otherwise every niche user in the population would be an
  // Annapurna user and the segment would test one region instead of the rule.
  const region = candidateRegions[Math.floor(rng() * candidateRegions.length)];
  const inRegion = byRegion.get(region)!;

  const anchor = shuffled(inRegion, rng)[0];
  const chosen: TrekMeta[] = [anchor];

  const siblings = inRegion
    .filter(t => t.trekId !== anchor.trekId && t.parentName === anchor.parentName)
    .sort((a, b) => tightness(anchor, a) - tightness(anchor, b) || a.trekId.localeCompare(b.trekId));

  const restOfRegion = inRegion
    .filter(t => t.trekId !== anchor.trekId && t.parentName !== anchor.parentName)
    .sort((a, b) => tightness(anchor, a) - tightness(anchor, b) || a.trekId.localeCompare(b.trekId));

  // Family first, then the tightest neighbours in the same region, then — only
  // if the region simply cannot fill the plan — the tightest routes anywhere.
  const elsewhere = pool
    .filter(t => t.region !== region)
    .sort((a, b) => tightness(anchor, a) - tightness(anchor, b) || a.trekId.localeCompare(b.trekId));

  for (const trek of [...siblings, ...restOfRegion, ...elsewhere]) {
    if (chosen.length >= count) break;
    chosen.push(trek);
  }
  return chosen;
}

/**
 * A deliberately spread plan: every pick maximises novelty against what the user
 * has already liked, across region, difficulty tier and price tier at once.
 *
 * Greedy rather than "one from each bucket" because the pool is not always rich
 * enough to supply one of everything — a user with a poor cardio answer has six
 * plausible routes across three regions — and a greedy walk degrades into "as
 * spread as this pool allows" instead of failing to build a plan at all.
 */
function diversePlan(pool: TrekMeta[], rng: () => number, count: number): TrekMeta[] {
  const order = shuffled(pool, rng);
  const chosen: TrekMeta[] = [order[0]];

  while (chosen.length < count) {
    const regions = new Set(chosen.map(t => t.region));
    const difficulties = new Set(chosen.map(t => t.difficulty));
    const tiers = new Set(chosen.map(t => t.priceTier));
    const families = new Set(chosen.map(t => t.parentName));
    const taken = new Set(chosen.map(t => t.trekId));

    let best: TrekMeta | null = null;
    let bestScore = -1;
    for (const trek of order) {
      if (taken.has(trek.trekId)) continue;
      // Region is weighted heaviest: it is the dimension the feed reacts to most
      // visibly, so it is the one worth spreading first.
      const score =
        (regions.has(trek.region) ? 0 : 3) +
        (difficulties.has(trek.difficulty) ? 0 : 2) +
        (tiers.has(trek.priceTier) ? 0 : 2) +
        (families.has(trek.parentName) ? 0 : 1);
      if (score > bestScore) {
        best = trek;
        bestScore = score;
      }
    }

    if (!best) break; // pool exhausted
    chosen.push(best);
  }
  return chosen;
}

/**
 * Build one person's like plan.
 *
 * Deterministic in `email`, so the same user always likes the same routes and a
 * re-run produces the same interaction corpus.
 */
export function planLikes(email: string, answers: HealthAnswers): LikePlan {
  const rng = mulberry32(seedFrom(`likes:${email}`));
  const style: LikeStyle = rng() < DIVERSE_SHARE ? 'diverse' : 'niche';
  const count = rng() < 0.5 ? MIN_LIKES : MAX_LIKES;

  let relaxed: string | undefined;
  let pool = TREK_METADATA.filter(t => isPlausibleFor(t, answers));

  if (pool.length < MIN_LIKES) {
    relaxed =
      `only ${pool.length} route(s) are safe for this health profile; ` +
      'the plan was widened to the whole catalogue';
    pool = [...TREK_METADATA];
  }

  const picked =
    style === 'diverse' ? diversePlan(pool, rng, count) : nichePlan(pool, rng, count);
  const likes = picked.map(toPlanned);

  const regions = Array.from(new Set(likes.map(l => l.region)));
  const summary =
    style === 'diverse'
      ? `diverse · ${regions.length} region(s): ${regions.join('+')} · ${likes.length} routes`
      : `niche · ${regions.join('+')} · ${Array.from(new Set(likes.map(l => l.difficulty))).join('/')} · ${likes.length} routes`;

  return { style, likes, summary, relaxed };
}
