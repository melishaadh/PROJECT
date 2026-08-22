import { Destination, Difficulty } from '@/data/destinations';
import { GATEWAY_TOKENS, isSoloFriendly, servesGateway, soloScore } from '@/lib/trekProfile';

// ─── 1. Lexicon ──────────────────────────────────────────────────────────────

/** Groups of interchangeable terms. Any term expands to the whole group. */
const SYNONYM_GROUPS: string[][] = [
  ['easy', 'beginner', 'beginners', 'family-friendly', 'family', 'kids', 'short', 'weekend', 'accessible', 'gentle', 'relaxed'],
  ['moderate', 'intermediate', 'medium'],
  ['hard', 'difficult', 'challenging', 'tough', 'strenuous', 'extreme', 'grueling', 'demanding', 'expert', 'technical', 'rugged'],
  ['lake', 'lakes', 'kunda', 'gosaikunda', 'tilicho', 'turquoise', 'pond'],
  ['everest', 'ebc', 'khumbu', 'kala patthar', 'gokyo', 'sagarmatha'],
  ['annapurna', 'abc', 'sanctuary', 'thorong', 'poon hill', 'ghorepani'],
  ['manaslu', 'larkya', 'tsum'],
  ['langtang', 'kyanjin', 'helambu'],
  ['mustang', 'lo manthang', 'forbidden', 'desert', 'arid'],
  ['pass', 'la', 'crossing', 'high pass'],
  ['peak', 'summit', 'ri', 'viewpoint', 'top'],
  ['sunrise', 'sunset', 'panorama', 'panoramic', 'views', 'view', 'scenic', 'sightseeing', 'photography', 'photographers'],
  ['culture', 'cultural', 'heritage', 'village', 'villages', 'monastery', 'monasteries', 'homestay', 'traditional', 'spiritual', 'pilgrimage', 'holy', 'sacred'],
  ['forest', 'rhododendron', 'jungle', 'nature', 'wilderness', 'remote', 'offbeat', 'off-the-beaten-path', 'quiet', 'secluded'],
  ['high altitude', 'altitude', 'high-altitude', 'glacier', 'glacial', 'alpine', 'snow'],
  ['winter', 'snowy', 'cold', 'snow', 'december', 'january', 'february'],
  ['spring', 'autumn', 'monsoon', 'season', 'seasonal'],
  ['teahouse', 'lodge', 'camping'],
];

const SYNONYM_INDEX = (() => {
  const idx = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      if (!idx.has(term)) idx.set(term, new Set());
      group.forEach(t => idx.get(term)!.add(t));
    }
  }
  return idx;
})();

/** Words that carry difficulty intent. */
const DIFFICULTY_TERMS: Record<string, Difficulty> = {
  easy: 'Easy', beginner: 'Easy', beginners: 'Easy', novice: 'Easy', starter: 'Easy',
  gentle: 'Easy', relaxed: 'Easy', gentler: 'Easy', gradual: 'Easy', gettingstarted: 'Easy',
  moderate: 'Moderate', intermediate: 'Moderate', medium: 'Moderate', average: 'Moderate',
  hard: 'Hard', difficult: 'Hard', challenging: 'Hard', challenge: 'Hard', tough: 'Hard',
  strenuous: 'Hard', extreme: 'Hard', grueling: 'Hard', gruelling: 'Hard', demanding: 'Hard',
  expert: 'Hard', advanced: 'Hard', technical: 'Hard', brutal: 'Hard', hardcore: 'Hard',
};

export type PriceTier = 'budget' | 'mid' | 'premium';

/** Words that carry price intent. */
const PRICE_TERMS: Record<string, PriceTier> = {
  cheap: 'budget', cheapest: 'budget', budget: 'budget', affordable: 'budget',
  inexpensive: 'budget', economical: 'budget', low: 'budget', lowcost: 'budget', value: 'budget',
  midrange: 'mid', moderate: 'mid', reasonable: 'mid',
  expensive: 'premium', premium: 'premium', luxury: 'premium', luxurious: 'premium',
  deluxe: 'premium', highend: 'premium', splurge: 'premium',
};

/** NPR ceilings that define each tier. */
const PRICE_TIER_RANGE: Record<PriceTier, { min: number; max: number }> = {
  budget: { min: 0, max: 25_000 },
  mid: { min: 25_000, max: 80_000 },
  premium: { min: 80_000, max: Number.MAX_SAFE_INTEGER },
};

/** Audience hints that imply softer routes. */
const AUDIENCE_TERMS: Record<string, 'family' | 'solo' | 'group'> = {
  family: 'family', families: 'family', kids: 'family', children: 'family', child: 'family',
  parents: 'family', elderly: 'family', seniors: 'family',
  solo: 'solo', alone: 'solo',
  group: 'group', friends: 'group', team: 'group',
};

/** Phrases that mean "no more than" / "at least". */
const UPPER_BOUND_WORDS = ['under', 'below', 'less', 'lesser', 'max', 'maximum', 'upto', 'within', 'atmost', 'cheaper', 'shorter', 'lower'];
const LOWER_BOUND_WORDS = ['over', 'above', 'more', 'atleast', 'min', 'minimum', 'beyond', 'higher', 'longer'];

// ─── 1b. Prefix / partial intent resolution ──────────────────────────────────

/**
 * A single resolvable intent word. `salience` decides who wins when one prefix
 * matches several entries: typing "exp" almost always means "expensive", not
 * "expert", and "ch" means "cheap", not "challenging".
 */
interface IntentTerm {
  term: string;
  kind: 'difficulty' | 'price' | 'audience' | 'duration';
  difficulty?: Difficulty;
  priceTier?: PriceTier;
  audience?: 'family' | 'solo' | 'group';
  /** Duration bound, in days, applied when kind is 'duration'. */
  maxDuration?: number;
  minDuration?: number;
  salience: number;
}

/**
 * How likely each head word is to be what someone meant by an ambiguous prefix.
 * Anything absent gets `DEFAULT_SALIENCE`, which keeps long tail synonyms from
 * beating the common word they share a prefix with.
 */
const SALIENCE: Record<string, number> = {
  // Price — the requirement's worked examples ("ch" → cheap, "exp" → expensive).
  cheap: 10, expensive: 10, budget: 9, luxury: 9, premium: 9, cheapest: 8,
  affordable: 7, inexpensive: 5, deluxe: 5, luxurious: 5, midrange: 6,
  // "moderate" is both a difficulty and a price word; difficulty is the common read.
  moderate: 2,
  // Difficulty.
  easy: 10, hard: 10, beginner: 9, difficult: 8, challenging: 8, intermediate: 7,
  // `expert` deliberately ranks low so it cannot outrank `expensive` on "exp".
  expert: 4, extreme: 4, strenuous: 4, technical: 3, grueling: 3, gruelling: 3,
  // Audience.
  family: 9, families: 6, group: 6, solo: 6, kids: 5, elderly: 5, seniors: 5,
  // Duration.
  short: 8, weekend: 7, quick: 6, long: 8, expedition: 5, extended: 5,
};

const DEFAULT_SALIENCE = 1;

/** Minimum prefix length before partial intent resolution kicks in. */
const MIN_INTENT_PREFIX = 2;
/** Minimum term length before free text is matched as a word prefix. */
const MIN_TEXT_PREFIX = 3;

/** Duration words the phrase pass handles exactly, resolvable by prefix too. */
const DURATION_TERMS: Record<string, { maxDuration?: number; minDuration?: number }> = {
  short: { maxDuration: 5 },
  quick: { maxDuration: 5 },
  weekend: { maxDuration: 5 },
  long: { minDuration: 12 },
  extended: { minDuration: 12 },
  expedition: { minDuration: 12 },
};

const INTENT_TERMS: IntentTerm[] = (() => {
  const salience = (term: string) => SALIENCE[term] ?? DEFAULT_SALIENCE;
  const terms: IntentTerm[] = [];

  for (const [term, difficulty] of Object.entries(DIFFICULTY_TERMS)) {
    terms.push({ term, kind: 'difficulty', difficulty, salience: salience(term) });
  }
  for (const [term, priceTier] of Object.entries(PRICE_TERMS)) {
    terms.push({ term, kind: 'price', priceTier, salience: salience(term) });
  }
  for (const [term, audience] of Object.entries(AUDIENCE_TERMS)) {
    terms.push({ term, kind: 'audience', audience, salience: salience(term) });
  }
  for (const [term, bounds] of Object.entries(DURATION_TERMS)) {
    terms.push({ term, kind: 'duration', ...bounds, salience: salience(term) });
  }

  // Longest first as the final tiebreak, so equal-salience ties are stable.
  return terms.sort((a, b) => b.salience - a.salience || a.term.localeCompare(b.term));
})();

/**
 * Resolve a partially-typed word to the intent it most likely stands for.
 *
 * Returns null for a token that is too short, is already an exact lexicon entry
 * (the exact pass owns those), or prefixes nothing at all.
 */
function resolvePartialIntent(token: string): IntentTerm | null {
  if (token.length < MIN_INTENT_PREFIX) return null;
  // An exact hit is not a partial match — let the precise pass handle it.
  if (DIFFICULTY_TERMS[token] || PRICE_TERMS[token] || AUDIENCE_TERMS[token]) return null;
  if (DURATION_TERMS[token]) return null;

  let best: IntentTerm | null = null;
  for (const candidate of INTENT_TERMS) {
    if (candidate.term === token || !candidate.term.startsWith(token)) continue;
    if (!best || candidate.salience > best.salience) best = candidate;
  }
  return best;
}

/**
 * Words with no search value of their own.
 *
 * The conversational half of this list matters as much as the grammatical half.
 * A query arrives as a sentence — "family friendly trek suggestions", "recommend
 * a cheap trek", "treks near kathmandu" — and every word in it that was not
 * consumed as a constraint survived into the free-text pass as a *required*
 * term. The catalogue contains none of them, so the query either narrowed to
 * whichever single route's prose happened to contain the word, or emptied:
 *
 *   "family friendly treks"   → 1 route — the only one whose keywords literally
 *                               say "family-friendly" — instead of the easy ones
 *   "treks near kathmandu"    → a 20-day Dolpo expedition, because its copy is
 *                               the only one containing "nearby"
 *   "trek suggestions"        → nothing at all
 *
 * `friendly` is here for the same reason but is worth naming separately: it is a
 * suffix that qualifies the word in front of it — family friendly, budget
 * friendly, beginner friendly — and that word is already parsed on its own. The
 * "friendly" half carries no meaning the parse has not already taken, and could
 * only ever subtract from the result set.
 *
 * `near` likewise: "near pokhara" is resolved by the gateway pass from the city
 * name, and "near me" asks for a proximity the app has no location to compute.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'me', 'my', 'i',
  'want', 'need', 'looking', 'look', 'show', 'find', 'get', 'give', 'some', 'any', 'that', 'is',
  'are', 'be', 'trek', 'treks', 'trekking', 'route', 'routes', 'trail', 'trails', 'hike', 'hikes',
  'hiking', 'please', 'something', 'than', 'nrs', 'npr', 'rs', 'rupees', 'rupee', 'days', 'day',
  'nights', 'night', 'meters', 'meter', 'metres', 'metre', 'm', 'km', 'altitude', 'elevation',
  'price', 'cost', 'costs', 'priced', 'budgeted',
  // Conversational filler — the way a request is phrased, not what it asks for.
  'friendly', 'suggest', 'suggests', 'suggested', 'suggestion', 'suggestions',
  'recommend', 'recommends', 'recommended', 'recommendation', 'recommendations',
  'option', 'options', 'idea', 'ideas', 'suitable', 'good', 'best', 'great', 'nice',
  'near', 'nearby', 'around', 'close', 'popular', 'list', 'anything', 'us', 'we',
]);

// ─── 2. Intent parsing ───────────────────────────────────────────────────────

/** Which direction, if any, the query asked results to be ordered by price. */
export type PriceSort = 'asc' | 'desc';

export interface SearchIntent {
  raw: string;
  difficulty: Difficulty | null;
  priceTier: PriceTier | null;
  audience: 'family' | 'solo' | 'group' | null;
  maxPrice: number | null;
  minPrice: number | null;
  /** An exact NPR figure the user typed, e.g. "18000". */
  exactPrice: number | null;
  maxAltitude: number | null;
  minAltitude: number | null;
  maxDuration: number | null;
  minDuration: number | null;
  /** An exact trip length the user typed, e.g. "7 days" or "7d". */
  exactDuration: number | null;
  /**
   * Ascending for a budget query, descending for a premium one. Applied as the
   * primary sort, so "cheap" genuinely lists cheapest-first rather than merely
   * restricting to the budget tier.
   */
  priceSort: PriceSort | null;
  /**
   * True when the query asked for solo trekking. Unlike `audience === 'solo'`,
   * which is only a hint, this is a hard constraint: a solo query returns solo
   * routes or nothing, because sending someone alone onto a restricted-permit or
   * expedition route is not a near miss to be relaxed into.
   */
  soloOnly: boolean;
  /**
   * Gateway city tokens the query named ("kathmandu", "pokhara"). OR-ed against
   * each other — a route qualifies if it is reached from any of them.
   */
  gateways: string[];
  /**
   * Terms a thematic phrase stood in for, matched **literally** — deliberately
   * not synonym-expanded.
   *
   * "flower filled" resolves to `rhododendron`, and rhododendron shares a
   * synonym group with forest, jungle, nature, wilderness and remote. Expanding
   * it made a query about flowers match 29 of 30 routes and put a 20-day Dolpo
   * expedition at the top, because its keywords say "wilderness". A theme is a
   * translation of what the user meant into a word the catalogue actually uses,
   * so it has to match that word and not its neighbourhood.
   */
  themeTerms: string[];
  /** Words left after structural terms were consumed — matched as free text. */
  textTerms: string[];
  /**
   * Partially-typed tokens that were resolved to an intent. They still nudge
   * ranking, but are never required to appear — an inferred word must not be
   * able to empty the result set.
   */
  softTerms: string[];
  /** Human-readable summary of everything that was understood. */
  labels: string[];
}

export const EMPTY_INTENT: SearchIntent = {
  raw: '',
  difficulty: null,
  priceTier: null,
  audience: null,
  maxPrice: null,
  minPrice: null,
  exactPrice: null,
  maxAltitude: null,
  minAltitude: null,
  maxDuration: null,
  minDuration: null,
  exactDuration: null,
  priceSort: null,
  soloOnly: false,
  gateways: [],
  themeTerms: [],
  textTerms: [],
  softTerms: [],
  labels: [],
};

/**
 * Split a token into its numeric value and any unit glued onto it:
 * "40k" → 40000, "3000m" → {3000, "m"}, "3,000" → 3000, "days" → null.
 */
function parseQuantityToken(token: string): { value: number; unit?: string } | null {
  const m = token.match(/^([\d][\d,.]*)\s*(k\b|k$)?\s*([a-z]*)$/i);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;

  let unit = (m[3] || '').toLowerCase();
  let value = base;
  // A lone "k" parses as the multiplier, not as a unit.
  if (m[2] || unit === 'k') {
    value = base * 1000;
    if (unit === 'k') unit = '';
  }
  return { value, unit: unit || undefined };
}

function isNumericToken(token: string): boolean {
  return parseQuantityToken(token) !== null;
}

/**
 * Classify a bare number using the unit that follows it, then the surrounding
 * words, then its magnitude. Nepali trek prices (8k-160k NPR) and altitudes
 * (3.2k-6.1k m) overlap numerically, so an explicit unit always wins and the
 * magnitude heuristic only settles genuinely ambiguous cases.
 */
type Quantity = 'price' | 'altitude' | 'duration';

function classifyQuantity(value: number, unit: string | undefined, context: string): Quantity | null {
  if (unit) {
    if (/^(m|meter|meters|metre|metres)$/.test(unit)) return 'altitude';
    if (/^(d|day|days|night|nights|week|weeks)$/.test(unit)) return 'duration';
    if (/^(npr|rs|rupee|rupees|nrs)$/.test(unit)) return 'price';
  }
  if (/\b(npr|rs|rupees?|nrs|price|cost|budget|spend)\b/.test(context)) return 'price';
  if (/\b(altitude|elevation|high|height)\b/.test(context)) return 'altitude';
  if (/\b(days?|nights?|weeks?|duration|long)\b/.test(context)) return 'duration';

  if (value <= 30) return 'duration';
  if (value >= 8000) return 'price';
  if (value >= 1500) return 'altitude';
  return null;
}

/**
 * The sort a price tier implies.
 *
 * Asking for "cheap" is asking to see the cheapest options, so restricting to
 * the budget tier is only half the job — the results have to be ordered by
 * price too, or the cheapest route can sit below a pricier one that happens to
 * score higher on text relevance. "Mid-range" implies no direction.
 */
function sortForTier(tier: PriceTier): PriceSort | null {
  if (tier === 'budget') return 'asc';
  if (tier === 'premium') return 'desc';
  return null;
}

/** Parse a natural-language query into structured constraints. */
export function parseSearchIntent(query: string): SearchIntent {
  const raw = query.trim();
  if (!raw) return { ...EMPTY_INTENT };

  const normalized = raw
    .toLowerCase()
    .replace(/[^\w\s.,'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const intent: SearchIntent = {
    ...EMPTY_INTENT,
    raw,
    gateways: [],
    themeTerms: [],
    textTerms: [],
    softTerms: [],
    labels: [],
  };
  /** Prefixes that were resolved to an intent, for the "understood" labels. */
  const inferred: { prefix: string; term: string }[] = [];

  // ── Phrase pass ───────────────────────────────────────────────────────────
  // Multi-word phrases are matched first and then *stripped* from the query, so
  // their words never leak into the free-text terms (a leftover "low" would
  // otherwise be required to appear in the trek copy).
  let rest = normalized;
  const applyPhrase = (re: RegExp, apply: () => void) => {
    if (re.test(rest)) {
      apply();
      rest = rest.replace(re, ' ');
    }
  };

  // `alt\w*` / `elev\w*` so a half-typed phrase still parses: "low alt",
  // "low altit" and "low elevation" all mean the same thing.
  applyPhrase(/\b(low|lower)[\s-]?(alt\w*|elev\w*)\b/g, () => {
    intent.maxAltitude = Math.min(intent.maxAltitude ?? Infinity, 3500);
  });
  applyPhrase(/\b(high|higher)[\s-]?(alt\w*|elev\w*)\b/g, () => {
    intent.minAltitude = Math.max(intent.minAltitude ?? 0, 4500);
  });
  applyPhrase(/\b(short|quick|weekend)\b/g, () => {
    intent.maxDuration = Math.min(intent.maxDuration ?? Infinity, 5);
  });
  applyPhrase(/\b(long|extended|expedition)\b/g, () => {
    intent.minDuration = Math.max(intent.minDuration ?? 0, 12);
  });

  /**
   * Solo intent.
   *
   * Matched as a phrase and stripped, so "solo trekking" does not leave a bare
   * "solo" to be required in the trek copy — no itinerary in the catalogue
   * contains the word, so requiring it as free text emptied every solo query.
   * All the ways somebody asks for this resolve to the same constraint.
   */
  applyPhrase(
    /\b(solo[\s-]?friendly|solo|individual[\s-](?:path|paths|trail|trails|trek|treks|route|routes)|by\s?myself|on\s?my\s?own|alone|independent(?:ly)?|single\s+(?:traveller|traveler|trekker))\b/g,
    () => {
      intent.soloOnly = true;
      intent.audience = 'solo';
    }
  );

  /**
   * Thematic tokens.
   *
   * These are words a user reaches for that appear nowhere in the catalogue —
   * "flower filled", "winter", "luxury". Each is translated into something the
   * data actually carries: a seed term that the synonym index expands (so the
   * match is an OR over the whole group, never a requirement for one literal
   * word), or a structural bound where the theme genuinely implies one.
   *
   * Without this, a thematic query matched nothing, fell through to the
   * relaxation path, and returned the entire catalogue in arbitrary order.
   */
  applyPhrase(
    /\b(rhododendrons?|flower[\s-]?(?:filled|covered)?|flowers|flowering|blooming|blossom(?:s|ing)?|wildflower(?:s)?)\b/g,
    () => {
      // Rhododendron is the catalogue's flowering signal — 20 routes describe it.
      //
      // The literal word is intercepted here too, not just the flower synonyms.
      // Left as ordinary free text it would be synonym-expanded into the forest
      // group (jungle, nature, wilderness, remote…) and "rhododendron trails"
      // would return 29 of 30 routes led by a Dolpo expedition. The reverse
      // direction still holds: a "forest" query expands to rhododendron as
      // before, because there the neighbourhood *is* what was asked for.
      intent.themeTerms.push('rhododendron');
    }
  );
  applyPhrase(/\b(winter|wintery|wintry)\b/g, () => {
    // Winter trekking means the lower teahouse routes: the high passes are
    // snowed shut. The altitude ceiling is the constraint that carries this;
    // "snow" is left out of the theme terms because requiring it would drop
    // perfectly good low-altitude winter routes whose copy never says the word.
    intent.maxAltitude = Math.min(intent.maxAltitude ?? Infinity, 4200);
  });

  /**
   * Gateway cities.
   *
   * Resolved against the curated region→gateway mapping rather than the
   * itinerary prose. Almost every route in the catalogue mentions Kathmandu
   * somewhere — the Khumbu flights leave from it and several treks simply end
   * there — so a prose match on "kathmandu" returned two thirds of the
   * catalogue. See `trekProfile.ts`.
   */
  for (const city of GATEWAY_TOKENS) {
    applyPhrase(new RegExp(`\\b${city}\\b`, 'g'), () => {
      if (!intent.gateways.includes(city)) intent.gateways.push(city);
    });
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  const consumed = new Set<number>();

  // ── Numeric pass ──────────────────────────────────────────────────────────
  //
  // A number is read as an **exact** value unless the words just before it say
  // otherwise. "7 days" means a seven-day trek, not "up to seven days"; only an
  // explicit "under"/"over" turns it into a bound. Treating every bare number
  // as an upper bound — which is what this used to do — meant searching for the
  // 18,000 NPR route returned every route at or below 18,000 instead.
  for (let i = 0; i < tokens.length; i++) {
    const parsed = parseQuantityToken(tokens[i]);
    if (!parsed) continue;

    // A unit may be glued to the number ("3000m") or stand alone ("3000 m").
    let unit = parsed.unit;
    let unitTokenIndex = -1;
    if (!unit && tokens[i + 1] && /^[a-z]+$/.test(tokens[i + 1])) {
      unit = tokens[i + 1];
      unitTokenIndex = i + 1;
    }

    const before = tokens.slice(Math.max(0, i - 3), i).join(' ');
    const kind = classifyQuantity(parsed.value, unit, `${before} ${tokens[i + 1] ?? ''}`);
    if (!kind) continue;

    const beforeWords = before.split(' ');
    const isLower = LOWER_BOUND_WORDS.some(w => beforeWords.includes(w));
    const isUpperBound = UPPER_BOUND_WORDS.some(w => beforeWords.includes(w));
    /** No comparison word at all → the user named a specific value. */
    const isExact = !isLower && !isUpperBound;

    consumed.add(i);
    if (unitTokenIndex >= 0) consumed.add(unitTokenIndex);
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (UPPER_BOUND_WORDS.includes(tokens[j]) || LOWER_BOUND_WORDS.includes(tokens[j])) {
        consumed.add(j);
      }
    }

    if (kind === 'price') {
      if (isExact) intent.exactPrice = parsed.value;
      else if (isLower) intent.minPrice = Math.max(intent.minPrice ?? 0, parsed.value);
      else intent.maxPrice = Math.min(intent.maxPrice ?? Infinity, parsed.value);
    } else if (kind === 'altitude') {
      // Altitude stays a bound even when bare: nobody searches for a peak that
      // is precisely 5,364m, but "5000m" as a rough ceiling is a real query.
      if (isLower) intent.minAltitude = Math.max(intent.minAltitude ?? 0, parsed.value);
      else intent.maxAltitude = Math.min(intent.maxAltitude ?? Infinity, parsed.value);
    } else {
      const days = /week/.test(unit ?? '') ? parsed.value * 7 : parsed.value;
      if (isExact) intent.exactDuration = days;
      else if (isLower) intent.minDuration = Math.max(intent.minDuration ?? 0, days);
      else intent.maxDuration = Math.min(intent.maxDuration ?? Infinity, days);
    }
  }

  // Categorical intent.
  tokens.forEach((token, i) => {
    if (consumed.has(i)) return;
    const word = token.replace(/[^a-z-]/g, '');
    if (!word) return;

    if (!intent.difficulty && DIFFICULTY_TERMS[word]) {
      intent.difficulty = DIFFICULTY_TERMS[word];
      consumed.add(i);
      return;
    }
    // "low" only means budget next to a price word; otherwise it is altitude.
    if (!intent.priceTier && PRICE_TERMS[word]) {
      const priceContext = /\b(price|cost|budget|npr|rs|rupees?|nrs)\b/.test(normalized);
      if (word !== 'low' || priceContext) {
        intent.priceTier = PRICE_TERMS[word];
        intent.priceSort ??= sortForTier(intent.priceTier);
        consumed.add(i);
        return;
      }
    }
    if (!intent.audience && AUDIENCE_TERMS[word]) {
      intent.audience = AUDIENCE_TERMS[word];
      consumed.add(i);
      return;
    }
  });

  // ── Partial / prefix intent pass ──────────────────────────────────────────
  // Only tokens the exact pass left behind are considered, and only dimensions
  // it did not already pin down. This is what makes "ch" mean budget and "exp"
  // mean premium while the user is still typing.
  tokens.forEach((token, i) => {
    if (consumed.has(i)) return;
    const word = token.replace(/[^a-z-]/g, '');
    if (!word || STOP_WORDS.has(word)) return;

    const match = resolvePartialIntent(word);
    if (!match) return;

    let applied = false;
    if (match.kind === 'difficulty' && !intent.difficulty && match.difficulty) {
      intent.difficulty = match.difficulty;
      applied = true;
    } else if (match.kind === 'price' && !intent.priceTier && match.priceTier) {
      intent.priceTier = match.priceTier;
      intent.priceSort ??= sortForTier(match.priceTier);
      applied = true;
    } else if (match.kind === 'audience' && !intent.audience && match.audience) {
      intent.audience = match.audience;
      applied = true;
    } else if (match.kind === 'duration') {
      if (match.maxDuration !== undefined) {
        intent.maxDuration = Math.min(intent.maxDuration ?? Infinity, match.maxDuration);
        applied = true;
      }
      if (match.minDuration !== undefined) {
        intent.minDuration = Math.max(intent.minDuration ?? 0, match.minDuration);
        applied = true;
      }
    }

    if (!applied) return;
    consumed.add(i);
    inferred.push({ prefix: word, term: match.term });
    // Kept as a soft signal: a route whose copy also starts with this prefix
    // ranks higher, but nothing is excluded for failing to contain an
    // inferred word.
    intent.softTerms.push(word);
  });

  // A family audience implies a gentler route unless the user said otherwise.
  if (intent.audience === 'family' && !intent.difficulty) {
    intent.difficulty = 'Easy';
  }

  // Whatever is left is free text.
  intent.textTerms = tokens
    .filter((_, i) => !consumed.has(i))
    .map(t => t.replace(/^[-']+|[-'.,]+$/g, ''))
    .filter(t => t.length > 1 && !STOP_WORDS.has(t) && !isNumericToken(t));

  intent.labels = describeIntent(intent, inferred);
  return intent;
}

function describeIntent(
  intent: SearchIntent,
  inferred: { prefix: string; term: string }[] = []
): string[] {
  const labels: string[] = [];
  if (intent.difficulty) labels.push(`${intent.difficulty} difficulty`);
  if (intent.priceTier) {
    labels.push(
      intent.priceTier === 'budget' ? 'Budget' : intent.priceTier === 'mid' ? 'Mid-range' : 'Premium'
    );
  }
  if (intent.audience === 'family') labels.push('Family friendly');
  if (intent.soloOnly) labels.push('Solo friendly');
  for (const city of intent.gateways) {
    labels.push(`From ${city.charAt(0).toUpperCase()}${city.slice(1)}`);
  }
  // Show the inference explicitly, so a prefix-driven result never looks like
  // the engine ignored what was typed: `exp… → expensive`.
  for (const { prefix, term } of inferred) {
    labels.push(`${prefix}… → ${term}`);
  }
  if (intent.exactPrice !== null) labels.push(`Exactly NPR ${intent.exactPrice.toLocaleString()}`);
  if (intent.exactDuration !== null) {
    labels.push(`Exactly ${intent.exactDuration} ${intent.exactDuration === 1 ? 'day' : 'days'}`);
  }
  if (intent.maxPrice !== null) labels.push(`Under NPR ${intent.maxPrice.toLocaleString()}`);
  if (intent.minPrice !== null) labels.push(`Over NPR ${intent.minPrice.toLocaleString()}`);
  if (intent.maxAltitude !== null) labels.push(`Below ${intent.maxAltitude.toLocaleString()}m`);
  if (intent.minAltitude !== null) labels.push(`Above ${intent.minAltitude.toLocaleString()}m`);
  if (intent.maxDuration !== null) labels.push(`Up to ${intent.maxDuration} days`);
  if (intent.minDuration !== null) labels.push(`${intent.minDuration}+ days`);
  if (intent.priceSort) {
    labels.push(intent.priceSort === 'asc' ? 'Cheapest first' : 'Most expensive first');
  }
  return labels;
}

// ─── 3. Matching ─────────────────────────────────────────────────────────────

/**
 * The route's own name — display title, family and variant.
 *
 * Kept separate from the wider prose because a title match is treated as
 * categorically better than a body match, not merely as a higher score: see
 * `searchTreksWithIntent`.
 */
function titleText(trek: Destination): string {
  return `${trek.displayTitle ?? ''} ${trek.parentName ?? ''} ${trek.childRoute ?? ''}`.toLowerCase();
}

/** Full lowercase searchable text for a trek, including itinerary prose. */
function haystack(trek: Destination): string {
  const parts: string[] = [
    trek.displayTitle,
    trek.parentName,
    trek.childRoute,
    trek.difficulty,
    trek.description ?? '',
    ...(trek.keywords ?? []),
    ...(trek.itinerary ?? []).flatMap(d => [d.title, d.description]),
  ];
  return parts.join(' ').toLowerCase();
}

const HAYSTACK_CACHE = new WeakMap<Destination, string>();
function cachedHaystack(trek: Destination): string {
  let h = HAYSTACK_CACHE.get(trek);
  if (h === undefined) {
    h = haystack(trek);
    HAYSTACK_CACHE.set(trek, h);
  }
  return h;
}

const TITLE_CACHE = new WeakMap<Destination, string>();
function cachedTitle(trek: Destination): string {
  let t = TITLE_CACHE.get(trek);
  if (t === undefined) {
    t = titleText(trek);
    TITLE_CACHE.set(trek, t);
  }
  return t;
}

/**
 * How many of `terms` appear in this route's name, whole-word or as a word
 * prefix. Used as a gate, not a score — a query that names a route should
 * return that route and nothing else.
 */
function titleMatchCount(trek: Destination, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = cachedTitle(trek);
  let matched = 0;
  for (const term of terms) {
    if (hasTerm(title, term) || hasPrefix(title, term)) matched += 1;
  }
  return matched;
}

/** Expand a single query token to itself plus any synonyms. */
function expand(token: string): string[] {
  const terms = new Set<string>([token]);
  SYNONYM_INDEX.get(token)?.forEach(t => terms.add(t));
  return Array.from(terms);
}

/**
 * Whole-word matcher for a term. Plain `includes` matched short terms inside
 * unrelated words — "tal" hit "total" and "crystal", "la" hit "lake" — which
 * made short queries match nearly the whole catalogue.
 */
const TERM_REGEX_CACHE = new Map<string, RegExp>();
function termRegex(term: string): RegExp {
  let re = TERM_REGEX_CACHE.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    TERM_REGEX_CACHE.set(term, re);
  }
  return re;
}

function hasTerm(haystackText: string, term: string): boolean {
  return termRegex(term).test(haystackText);
}

/**
 * Word-*prefix* matcher, so "gok" finds Gokyo and "anna" finds Annapurna while
 * the user is still typing.
 *
 * Anchored at a word boundary rather than matching anywhere in the string: an
 * unanchored `includes` was what previously let "tal" hit "total" and "crystal",
 * which made short queries match nearly the whole catalogue.
 */
const PREFIX_REGEX_CACHE = new Map<string, RegExp>();
function prefixRegex(term: string): RegExp {
  let re = PREFIX_REGEX_CACHE.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${escaped}[a-z0-9]*`, 'i');
    PREFIX_REGEX_CACHE.set(term, re);
  }
  return re;
}

/** True when some word in the text starts with `term`. Short terms are ignored. */
function hasPrefix(haystackText: string, term: string): boolean {
  if (term.length < MIN_TEXT_PREFIX) return false;
  return prefixRegex(term).test(haystackText);
}

/** True when the trek satisfies every structural constraint in the intent. */
function satisfiesConstraints(trek: Destination, intent: SearchIntent): boolean {
  if (intent.difficulty && trek.difficulty !== intent.difficulty) return false;

  /*
    Solo is a hard gate and is never relaxed.

    A restricted-area permit is only issued to a guided party of two or more, and
    an expedition-grade route needs camping and technical support. Neither is a
    near miss that could be loosened to fill out a thin result set — offering
    them to somebody who asked to trek alone would be offering them a route they
    cannot legally or safely walk.
  */
  if (intent.soloOnly && !isSoloFriendly(trek)) return false;

  // Gateway cities are OR-ed: "kathmandu pokhara" means either is fine.
  if (intent.gateways.length > 0 && !intent.gateways.some(g => servesGateway(trek, g))) {
    return false;
  }

  // Thematic terms, matched literally against the route's full text. See the
  // note on `SearchIntent.themeTerms` for why these are not synonym-expanded.
  if (intent.themeTerms.length > 0) {
    const hay = cachedHaystack(trek);
    if (!intent.themeTerms.every(term => hasTerm(hay, term) || hasPrefix(hay, term))) {
      return false;
    }
  }

  // An exact price is absolute — a query for "18000" means that price, so a
  // route at 18,001 is not a near miss to be included, it is a non-match.
  //
  // An exact *duration* deliberately is not. "7 days" is a target rather than a
  // specification: a trekker with a week free would still rather see the 6- and
  // 8-day routes than an empty screen. Duration proximity is applied as the
  // primary sort key instead, so exact matches lead and nearby lengths follow
  // progressively — see `durationDelta` and `orderResults`.
  if (intent.exactPrice !== null && trek.priceNPR !== intent.exactPrice) return false;

  if (intent.maxPrice !== null && trek.priceNPR > intent.maxPrice) return false;
  if (intent.minPrice !== null && trek.priceNPR < intent.minPrice) return false;
  if (intent.maxAltitude !== null && trek.maxAltitude > intent.maxAltitude) return false;
  if (intent.minAltitude !== null && trek.maxAltitude < intent.minAltitude) return false;
  if (intent.maxDuration !== null && trek.durationDays > intent.maxDuration) return false;
  if (intent.minDuration !== null && trek.durationDays < intent.minDuration) return false;

  if (intent.priceTier) {
    const { min, max } = PRICE_TIER_RANGE[intent.priceTier];
    if (trek.priceNPR < min || trek.priceNPR > max) return false;
  }
  return true;
}

/**
 * Relevance for the free-text half of the query. Hits in the title outrank
 * hits in the keyword list, which outrank hits buried in an itinerary
 * description. `matched` counts how many of the query's terms landed at all.
 *
 * A whole-word hit always beats a word-prefix hit, so "gokyo" still ranks the
 * Gokyo routes above whatever else "gok" happens to prefix.
 */
function textScore(trek: Destination, terms: string[]): { score: number; matched: number } {
  if (terms.length === 0) return { score: 0, matched: 0 };
  const hay = cachedHaystack(trek);
  const title = `${trek.displayTitle} ${trek.parentName} ${trek.childRoute}`.toLowerCase();
  const keywords = (trek.keywords ?? []).join(' ').toLowerCase();

  let score = 0;
  let matched = 0;
  for (const term of terms) {
    const variants = expand(term);
    const wholeWord = variants.some(v => hasTerm(hay, v));
    const asPrefix = !wholeWord && variants.some(v => hasPrefix(hay, v));
    if (!wholeWord && !asPrefix) continue;
    matched += 1;

    // The literal term outranks a synonym, and a title hit outranks a body hit.
    if (wholeWord) {
      const exact = hasTerm(title, term) ? 1 : 0;
      if (variants.some(v => hasTerm(title, v))) score += 3 + exact;
      else if (variants.some(v => hasTerm(keywords, v))) score += 2;
      else score += 1;
    } else {
      // Half the weight of the equivalent whole-word hit — a prefix is a guess.
      if (variants.some(v => hasPrefix(title, v))) score += 1.5;
      else if (variants.some(v => hasPrefix(keywords, v))) score += 1;
      else score += 0.5;
    }
  }
  return { score, matched };
}

/**
 * Ranking-only bonus for prefixes that were resolved to an intent. These never
 * gate a result — an inferred word must not be able to exclude anything — they
 * just float the routes whose copy also matches what was typed.
 */
function softScore(trek: Destination, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = `${trek.displayTitle} ${trek.parentName} ${trek.childRoute}`.toLowerCase();
  const keywords = (trek.keywords ?? []).join(' ').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (hasPrefix(title, term)) score += 0.75;
    else if (hasPrefix(keywords, term)) score += 0.5;
  }
  return score;
}

function hasNumericBounds(intent: SearchIntent): boolean {
  return (
    intent.maxPrice !== null || intent.minPrice !== null || intent.exactPrice !== null ||
    intent.maxAltitude !== null || intent.minAltitude !== null ||
    intent.maxDuration !== null || intent.minDuration !== null || intent.exactDuration !== null
  );
}

/** How far a trek misses the requested figures, normalised per dimension. */
function boundMiss(trek: Destination, intent: SearchIntent): number {
  let miss = 0;
  if (intent.maxAltitude !== null) miss += Math.max(0, trek.maxAltitude - intent.maxAltitude) / 1000;
  if (intent.minAltitude !== null) miss += Math.max(0, intent.minAltitude - trek.maxAltitude) / 1000;
  if (intent.maxDuration !== null) miss += Math.max(0, trek.durationDays - intent.maxDuration) / 5;
  if (intent.minDuration !== null) miss += Math.max(0, intent.minDuration - trek.durationDays) / 5;
  if (intent.maxPrice !== null) miss += Math.max(0, trek.priceNPR - intent.maxPrice) / 20000;
  if (intent.minPrice !== null) miss += Math.max(0, intent.minPrice - trek.priceNPR) / 20000;
  // An exact figure misses in either direction, which is what orders the
  // "nothing matched exactly" fallback by closeness.
  if (intent.exactDuration !== null) miss += Math.abs(trek.durationDays - intent.exactDuration) / 5;
  if (intent.exactPrice !== null) miss += Math.abs(trek.priceNPR - intent.exactPrice) / 20000;
  return miss;
}

/**
 * How far a route's length is from the one the query named. 0 is an exact hit.
 *
 * This is what delivers progressive duration fallback: a "7 days" query orders
 * the 7-day routes first, then the 6- and 8-day routes, then 5 and 9, rather
 * than hard-filtering to 7 and showing an empty screen when nothing is listed
 * at exactly that length.
 */
function durationDelta(trek: Destination, intent: SearchIntent): number {
  if (intent.exactDuration === null) return 0;
  return Math.abs((trek.durationDays ?? 0) - intent.exactDuration);
}

/** Smallest useful result set a duration query should settle for before widening. */
const DURATION_BAND_MIN_RESULTS = 5;
/** How far from the requested length "nearby" is allowed to stretch, in days. */
const DURATION_BAND_MAX_DELTA = 4;

/**
 * Narrow to the routes at or near the requested length.
 *
 * Proximity ordering alone is not enough: sorting the catalogue by closeness to
 * "7 days" still hands back all thirty routes, with a 20-day expedition sitting
 * at the bottom of a list the user was told matched their week off. So the band
 * opens at zero — exact matches only — and widens a day at a time until it holds
 * a useful number of routes.
 *
 * The band never empties the result set: if even the widest band finds nothing
 * (a query for a length far outside the catalogue's range), every candidate is
 * returned and `orderResults` puts the closest first.
 */
function withinDurationBand(treks: Destination[], intent: SearchIntent): Destination[] {
  if (intent.exactDuration === null || treks.length === 0) return treks;

  for (let delta = 0; delta <= DURATION_BAND_MAX_DELTA; delta++) {
    const band = treks.filter(t => durationDelta(t, intent) <= delta);
    if (band.length >= Math.min(DURATION_BAND_MIN_RESULTS, treks.length)) return band;
  }

  const widest = treks.filter(t => durationDelta(t, intent) <= DURATION_BAND_MAX_DELTA);
  return widest.length > 0 ? widest : treks;
}

/**
 * The final ordering, as one stable comparator chain.
 *
 * Precedence, outermost first:
 *
 *   1. **Duration proximity.** The most specific thing a user can ask for. When
 *      they say "7 days" they have a week of leave booked, so length leads and
 *      everything else orders *within* each length band.
 *   2. **Price direction.** "cheap" lists cheapest-first, "luxury"
 *      most-expensive-first — so "cheap 7 days" reads as the 7-day routes
 *      cheapest-first, then the 6- and 8-day routes cheapest-first.
 *   3. **Relevance.** The text and soft-signal score.
 *   4. **Incoming order.** On For You that is the personalised ranking, and
 *      after a bounds relaxation it is the closest-match ordering, so ties stay
 *      meaningful rather than arbitrary.
 *
 * A single sort with the whole chain replaces what used to be two passes; a
 * second `sort` over the output of the first discarded the earlier keys entirely
 * whenever the later one found any difference at all.
 */
function orderResults<T extends { trek: Destination; score: number }>(
  scored: T[],
  intent: SearchIntent,
  incomingOrder: Map<string, number>
): T[] {
  const priceDirection = intent.priceSort === 'asc' ? 1 : intent.priceSort === 'desc' ? -1 : 0;

  return [...scored].sort((a, b) => {
    if (intent.exactDuration !== null) {
      const delta = durationDelta(a.trek, intent) - durationDelta(b.trek, intent);
      if (delta !== 0) return delta;
    }
    if (priceDirection !== 0) {
      const byPrice = priceDirection * ((a.trek.priceNPR ?? 0) - (b.trek.priceNPR ?? 0));
      if (byPrice !== 0) return byPrice;
    }
    if (b.score !== a.score) return b.score - a.score;
    return (incomingOrder.get(a.trek.id) ?? 0) - (incomingOrder.get(b.trek.id) ?? 0);
  });
}

export interface SearchResult {
  treks: Destination[];
  intent: SearchIntent;
  /** True when the query had to be loosened to avoid an empty result set. */
  relaxed: boolean;
}

/**
 * Run a natural-language query over a trek list. Returns the matching treks in
 * relevance order plus the intent that was understood.
 *
 * Free-text terms are ANDed first. If that yields nothing but the structural
 * constraints alone do match treks, the terms are relaxed to soft ranking
 * signals instead — a conversational query like "challenging winter routes"
 * should return the challenging treks ranked by winter-ness, not an empty list
 * just because no itinerary happens to contain the word "winter".
 */
export function searchTreksWithIntent(treks: Destination[], query: string): SearchResult {
  const intent = parseSearchIntent(query);
  // An empty query still honours a sort if one was somehow parsed, but is
  // otherwise the identity — the caller's own ordering is preserved.
  if (!intent.raw) return { treks, intent, relaxed: false };

  let eligible = treks.filter(t => satisfiesConstraints(t, intent));
  let relaxedBounds = false;

  // A figure the catalogue cannot satisfy — "under 3000m" when the lowest route
  // peaks at 3,210m, or an exact price no route is listed at — would otherwise
  // return an empty screen. Drop the numeric constraints, keep the categorical
  // intent, and rank by how close each trek comes to what was asked for.
  if (eligible.length === 0 && hasNumericBounds(intent)) {
    const categorical: SearchIntent = {
      ...intent,
      maxPrice: null, minPrice: null, exactPrice: null,
      maxAltitude: null, minAltitude: null,
      maxDuration: null, minDuration: null, exactDuration: null,
    };
    const fallback = treks.filter(t => satisfiesConstraints(t, categorical));
    if (fallback.length > 0) {
      eligible = [...fallback].sort((a, b) => boundMiss(a, intent) - boundMiss(b, intent));
      relaxedBounds = true;
    }
  }

  // Progressive duration fallback: exact length first, widening outwards only as
  // far as it needs to for a useful result set.
  eligible = withinDurationBand(eligible, intent);

  const termCount = intent.textTerms.length;

  /**
   * Title gate.
   *
   * When the free text names a route, only routes whose *name* matches are
   * returned. Searching "Gokyo" has to yield the Gokyo routes — not every trek
   * whose day-nine itinerary mentions passing through Gokyo, which is what a
   * whole-haystack match produced. Prose is searched only when no title
   * matches at all, so a genuinely descriptive query like "winter" still works.
   */
  let pool = eligible;
  if (termCount > 0) {
    const titled = eligible.filter(t => titleMatchCount(t, intent.textTerms) === termCount);
    // Fall back to partial title coverage before giving up on titles entirely.
    const partiallyTitled =
      titled.length > 0 ? titled : eligible.filter(t => titleMatchCount(t, intent.textTerms) > 0);
    if (partiallyTitled.length > 0) pool = partiallyTitled;
  }

  const scored = pool.map(trek => {
    const text = textScore(trek, intent.textTerms);
    // A solo query orders its survivors by how obviously independent-friendly
    // they are, so a first-time solo trekker meets Ghorepani before the Three
    // Passes. Purely a ranking term — the gate in `satisfiesConstraints` has
    // already decided membership.
    const solo = intent.soloOnly ? soloScore(trek) : 0;
    return {
      trek,
      matched: text.matched,
      score: text.score + softScore(trek, intent.softTerms) + solo,
    };
  });

  const strict = scored.filter(s => s.matched === termCount);
  /**
   * Did the query narrow the catalogue by anything other than free text?
   *
   * This decides whether an unmatched leftover word is allowed to empty the
   * screen. It has to count *every* gate `satisfiesConstraints` applies, not
   * just the difficulty/price/numeric ones: a solo, gateway or thematic query
   * has already filtered `eligible` down to a genuinely correct set, so an
   * unrecognised trailing word should fall back to that set rather than discard
   * it. Missing those three is what made "solo friendly trek suggestions" return
   * an empty list while "easy trek suggestions" returned the easy routes.
   */
  const hasConstraints =
    intent.difficulty !== null ||
    intent.priceTier !== null ||
    intent.audience !== null ||
    intent.soloOnly ||
    intent.gateways.length > 0 ||
    intent.themeTerms.length > 0 ||
    hasNumericBounds(intent);

  let winners = strict;
  let relaxed = false;
  if (winners.length === 0 && termCount > 0) {
    // Keep anything that matched at least one term; if the query was purely
    // structural in effect, fall back to the constraint matches themselves.
    const partial = scored.filter(s => s.matched > 0);
    winners = partial.length > 0 ? partial : hasConstraints ? scored : [];
    relaxed = winners.length > 0;
  }

  const order = new Map(pool.map((t, i) => [t.id, i]));
  const ordered = orderResults(winners, intent, order);

  return { treks: ordered.map(s => s.trek), intent, relaxed: relaxed || relaxedBounds };
}

/** Filter a list of treks by the semantic query (empty query → unchanged). */
export function searchTreks(treks: Destination[], query: string): Destination[] {
  return searchTreksWithIntent(treks, query).treks;
}

/** True when the trek matches the query. */
export function trekMatches(trek: Destination, query: string): boolean {
  return searchTreksWithIntent([trek], query).treks.length > 0;
}
