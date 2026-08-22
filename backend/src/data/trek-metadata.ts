/**
 * Server-side trek catalogue — the authoritative source for the 30 official
 * trekking destinations.
 *
 * The Expo app keeps the presentation layer (long descriptions, day-by-day
 * itineraries, bundled images) in `data/destinations.ts`, but every attribute
 * the *database* and the *recommendation engine* need lives here: region,
 * difficulty, duration, price, price tier, altitude and keywords. This file is
 * what the Mongo seeder writes, so the destinations collection is never empty
 * and always carries complete attributes.
 *
 * There is deliberately **no popularity field**. Every destination is seeded
 * with a like count of exactly zero and the only thing that ever moves it is a
 * real user tapping a heart, so the trending leaderboard reflects strictly
 * organic activity. Nothing here fabricates a head start for any route.
 *
 * Keep the ids in sync with the frontend catalogue.
 */

export type Difficulty = 'Easy' | 'Moderate' | 'Hard';
export type PriceTier = 'budget' | 'mid' | 'premium';

/** NPR ceilings that define each price tier. Mirrors the client's search lexicon. */
export const PRICE_TIER_RANGE: Record<PriceTier, { min: number; max: number }> = {
  budget: { min: 0, max: 25_000 },
  mid: { min: 25_000, max: 80_000 },
  premium: { min: 80_000, max: Number.MAX_SAFE_INTEGER },
};

/** The 0-2 ordinal the behavioural affinity layer treats as a price axis. */
export const PRICE_TIER_ORDINAL: Record<PriceTier, number> = {
  budget: 0,
  mid: 1,
  premium: 2,
};

export interface KnnProfile {
  ageGroup: number;
  experienceLevel: number;
  cardioFlag: number;
  jointFlag: number;
  altitudeHistory: number;
}

export interface TrekMeta {
  trekId: string;
  /** Short display name, e.g. "Classic ABC". */
  name: string;
  /** The trek family, e.g. "Annapurna Base Camp Trek". */
  parentName: string;
  /** The specific variant, e.g. "ABC via Ghandruk". */
  childRoute: string;
  /** Himalayan region the route sits in. */
  region: string;
  /** Human-readable location line stored on the destination document. */
  location: string;
  maxAltitude: number;
  difficulty: Difficulty;
  durationDays: number;
  priceNPR: number;
  priceTier: PriceTier;
  keywords: string[];
  /** The "ideal" trekker profile a route naturally suits (KNN corpus label). */
  knnProfile: KnnProfile;
}

// ─── Derivations ──────────────────────────────────────────────────────────────

/** Difficulty banding by maximum altitude. */
export function difficultyFor(alt: number): Difficulty {
  if (alt <= 3500) return 'Easy';
  if (alt <= 4500) return 'Moderate';
  return 'Hard';
}

/** Which altitude-history bracket a route demands (0-3). */
export function altitudeHistoryFor(alt: number): number {
  return alt <= 3500 ? 0 : alt <= 4500 ? 1 : alt <= 5500 ? 2 : 3;
}

function experienceFor(d: Difficulty): number {
  return d === 'Easy' ? 0 : d === 'Moderate' ? 2 : 3;
}

/**
 * The peer bracket a route is labelled as naturally suiting, in the five-bracket
 * space defined in `common/age.ts`.
 *
 * This is the KNN corpus label for the `ageGroup` dimension — the "ideal
 * trekker" a route is closest to — and it is graded rather than binary:
 *
 *   Hard     → [2] Active Adventurers (30–35): the bracket that combines peak
 *              sustained physical load with enough seasons to have earned it.
 *   Moderate → [3] Experienced Trekkers (36–41).
 *   Easy     → [4] Seasoned Explorers (42–50+): comfortable for the bracket the
 *              engine is most cautious about, and therefore for everyone below.
 *
 * The gradient matters more than the absolute positions: what the distance term
 * actually expresses is that the younger a bracket is, the closer it sits to the
 * demanding end of the catalogue. The hard *limits* are not here — those are the
 * safety matrix and the per-bracket load ceiling in the recommendation engine.
 */
export function idealBracketFor(d: Difficulty): number {
  return d === 'Hard' ? 2 : d === 'Moderate' ? 3 : 4;
}

export function priceTierFor(priceNPR: number): PriceTier {
  if (priceNPR <= PRICE_TIER_RANGE.budget.max) return 'budget';
  if (priceNPR <= PRICE_TIER_RANGE.mid.max) return 'mid';
  return 'premium';
}

// ─── The 30 official destinations ─────────────────────────────────────────────

interface RawTrek {
  id: string;
  name: string;
  parentName: string;
  childRoute: string;
  region: string;
  location: string;
  maxAltitude: number;
  durationDays: number;
  priceNPR: number;
  keywords: string[];
}

const RAW: RawTrek[] = [
  {
    id: '1', name: 'Classic ABC',
    parentName: 'Annapurna Base Camp Trek', childRoute: 'ABC via Ghandruk',
    region: 'Annapurna', location: 'Annapurna Sanctuary, Gandaki',
    maxAltitude: 4130, durationDays: 7, priceNPR: 18000,
    keywords: ['teahouse', 'traditional', 'gurung village', 'sanctuary', 'valley hike', 'sightseeing'],
  },
  {
    id: '2', name: 'Poon Hill Panorama ABC',
    parentName: 'Annapurna Base Camp Trek', childRoute: 'ABC via Poon Hill',
    region: 'Annapurna', location: 'Ghorepani & Annapurna Sanctuary, Gandaki',
    maxAltitude: 4130, durationDays: 10, priceNPR: 22000,
    keywords: ['sunrise viewpoint', 'rhododendron', 'photography', 'scenic', 'hills'],
  },
  {
    id: '3', name: 'Thorong La Circuit',
    parentName: 'Annapurna Circuit Trek', childRoute: 'Circuit via Thorong La Pass',
    region: 'Annapurna', location: 'Manang & Mustang, Gandaki',
    maxAltitude: 5416, durationDays: 10, priceNPR: 25000,
    keywords: ['high pass', 'legendary', 'challenging', 'iconic', 'himalayan crossing'],
  },
  {
    id: '4', name: 'Tilicho Lake Circuit',
    parentName: 'Annapurna Circuit Trek', childRoute: 'Circuit via Tilicho Lake',
    region: 'Annapurna', location: 'Manang, Gandaki',
    maxAltitude: 4919, durationDays: 8, priceNPR: 22000,
    keywords: ['turquoise water', 'glacial', 'lake', 'wilderness', 'photography'],
  },
  {
    id: '5', name: 'Ghorepani Sunrise Express',
    parentName: 'Ghorepani Poon Hill Trek', childRoute: 'Poon Hill Short Loop',
    region: 'Annapurna', location: 'Ghorepani, Gandaki',
    maxAltitude: 3210, durationDays: 3, priceNPR: 8000,
    keywords: ['family-friendly', 'short', 'easy', 'weekend', 'beginners', 'panoramic'],
  },
  {
    id: '6', name: 'Mohare Danda Community Trek',
    parentName: 'Ghorepani Poon Hill Trek', childRoute: 'Poon Hill and Mohare Danda',
    region: 'Annapurna', location: 'Myagdi, Gandaki',
    maxAltitude: 3300, durationDays: 4, priceNPR: 10000,
    keywords: ['offbeat', 'local homestay', 'sustainable', 'quiet', 'authentic'],
  },
  {
    id: '7', name: 'Gokyo Lakes & EBC',
    parentName: 'Everest Base Camp Trek', childRoute: 'EBC via Gokyo Lakes',
    region: 'Everest', location: 'Khumbu, Solukhumbu',
    maxAltitude: 5357, durationDays: 14, priceNPR: 55000,
    keywords: ['glacial pools', 'high altitude', 'lake', 'epic views', 'adventure'],
  },
  {
    id: '8', name: 'Everest Base Camp Classic',
    parentName: 'Everest Base Camp Trek', childRoute: 'EBC Classic Route',
    region: 'Everest', location: 'Khumbu, Solukhumbu',
    maxAltitude: 5364, durationDays: 11, priceNPR: 45000,
    keywords: ['iconic', 'world-famous', 'bucket-list', 'base camp', 'sherpa'],
  },
  {
    id: '9', name: 'Renjo La Three Passes',
    parentName: 'Everest Three Passes Trek', childRoute: 'Three Passes via Renjo La',
    region: 'Everest', location: 'Khumbu, Solukhumbu',
    maxAltitude: 5388, durationDays: 16, priceNPR: 70000,
    keywords: ['expert', 'grueling', 'remote', 'high-altitude', 'technical'],
  },
  {
    id: '10', name: 'Kongma La Three Passes',
    parentName: 'Everest Three Passes Trek', childRoute: 'Three Passes via Kongma La',
    region: 'Everest', location: 'Khumbu, Solukhumbu',
    maxAltitude: 5535, durationDays: 18, priceNPR: 75000,
    keywords: ['extreme', 'alpine', 'wilderness', 'rugged', 'expedition'],
  },
  {
    id: '11', name: 'Gokyo Valley & Lakes',
    parentName: 'Gokyo Valley Trek', childRoute: 'Gokyo Lakes Loop',
    region: 'Everest', location: 'Gokyo Valley, Solukhumbu',
    maxAltitude: 5357, durationDays: 12, priceNPR: 45000,
    keywords: ['majestic', 'peaceful', 'turquoise', 'alpine meadow', 'tranquil'],
  },
  {
    id: '12', name: 'Renjo La Pass Viewpoint',
    parentName: 'Gokyo Valley Trek', childRoute: 'Gokyo Renjo La Pass',
    region: 'Everest', location: 'Gokyo Valley, Solukhumbu',
    maxAltitude: 5388, durationDays: 14, priceNPR: 55000,
    keywords: ['high-altitude view', 'panoramic', 'adventure', 'dramatic', 'photography'],
  },
  {
    id: '13', name: 'Langtang Valley Sanctuary',
    parentName: 'Langtang Valley Trek', childRoute: 'Langtang Valley Classic',
    region: 'Langtang', location: 'Langtang Valley, Bagmati',
    maxAltitude: 3798, durationDays: 7, priceNPR: 20000,
    keywords: ['accessible', 'spiritual', 'cultural', 'nature', 'rhododendron'],
  },
  {
    id: '14', name: 'Langtang & Sacred Lakes',
    parentName: 'Langtang Valley Trek', childRoute: 'Langtang and Gosaikunda',
    region: 'Langtang', location: 'Langtang & Gosaikunda, Bagmati',
    maxAltitude: 4380, durationDays: 10, priceNPR: 28000,
    keywords: ['holy water', 'pilgrimage', 'mountain lakes', 'panoramic', 'cultural'],
  },
  {
    id: '15', name: 'Helambu Cultural Loop',
    parentName: 'Helambu Trek', childRoute: 'Helambu Circuit',
    region: 'Langtang', location: 'Helambu, Bagmati',
    maxAltitude: 3640, durationDays: 5, priceNPR: 12000,
    keywords: ['cultural', 'short', 'easy', 'heritage', 'village-life'],
  },
  {
    id: '16', name: 'Helambu Spiritual Trail',
    parentName: 'Helambu Trek', childRoute: 'Helambu via Gosaikunda',
    region: 'Langtang', location: 'Helambu & Gosaikunda, Bagmati',
    maxAltitude: 4380, durationDays: 8, priceNPR: 18000,
    keywords: ['spiritual', 'scenic', 'holy', 'nature', 'meditative'],
  },
  {
    id: '17', name: 'Manaslu & Tsum Valley',
    parentName: 'Manaslu Circuit Trek', childRoute: 'Manaslu via Tsum Valley',
    region: 'Manaslu', location: 'Tsum Valley & Manaslu, Gorkha',
    maxAltitude: 5106, durationDays: 18, priceNPR: 80000,
    keywords: ['hidden', 'ancient culture', 'remote', 'spiritual', 'secluded'],
  },
  {
    id: '18', name: 'Manaslu Round',
    parentName: 'Manaslu Circuit Trek', childRoute: 'Manaslu Classic Circuit',
    region: 'Manaslu', location: 'Budhi Gandaki Valley, Gorkha',
    maxAltitude: 5106, durationDays: 14, priceNPR: 60000,
    keywords: ['remote', 'challenging', 'authentic', 'rugged', 'off-the-beaten-path'],
  },
  {
    id: '19', name: 'Mustang Forbidden Kingdom',
    parentName: 'Upper Mustang Trek', childRoute: 'Mustang Lo Manthang',
    region: 'Mustang', location: 'Lo Manthang, Upper Mustang',
    maxAltitude: 3840, durationDays: 12, priceNPR: 120000,
    keywords: ['desert', 'ancient civilization', 'forbidden', 'mystic', 'cliff-caves', 'arid'],
  },
  {
    id: '20', name: 'Damodar Kunda Expedition',
    parentName: 'Upper Mustang Trek', childRoute: 'Mustang via Damodar Kunda',
    region: 'Mustang', location: 'Damodar Kunda, Upper Mustang',
    maxAltitude: 5100, durationDays: 16, priceNPR: 150000,
    keywords: ['pilgrimage', 'remote', 'sacred', 'high-altitude', 'expedition'],
  },
  {
    id: '21', name: 'Dolpo-Jomsom Wilderness',
    parentName: 'Upper Dolpo Trek', childRoute: 'Dolpo to Jomsom',
    region: 'Dolpo', location: 'Upper Dolpo to Jomsom, Karnali',
    maxAltitude: 5360, durationDays: 20, priceNPR: 160000,
    keywords: ['wilderness', 'remote', 'expedition', 'trans-himalayan', 'camping'],
  },
  {
    id: '22', name: 'Lower Dolpo Jewels',
    parentName: 'Upper Dolpo Trek', childRoute: 'Lower Dolpo Circuit',
    region: 'Dolpo', location: 'Phoksundo, Lower Dolpo',
    maxAltitude: 4920, durationDays: 18, priceNPR: 130000,
    keywords: ['lake', 'remote', 'offbeat', 'wilderness', 'camping'],
  },
  {
    id: '23', name: 'Mardi Forest Explorer',
    parentName: 'Mardi Himal Trek', childRoute: 'Mardi via Forest Camp',
    region: 'Annapurna', location: 'Mardi Himal, Gandaki',
    maxAltitude: 3500, durationDays: 3, priceNPR: 8000,
    keywords: ['forest', 'short', 'easy', 'weekend', 'beginners', 'ridge'],
  },
  {
    id: '24', name: 'Mardi Himal Sky Base',
    parentName: 'Mardi Himal Trek', childRoute: 'Mardi Base Camp Direct',
    region: 'Annapurna', location: 'Mardi Himal Base Camp, Gandaki',
    maxAltitude: 4200, durationDays: 4, priceNPR: 12000,
    keywords: ['ridge', 'panoramic', 'short', 'scenic', 'viewpoint'],
  },
  {
    id: '25', name: 'Dhaulagiri High Base Camp',
    parentName: 'Dhaulagiri Circuit Trek', childRoute: 'Dhaulagiri Base Camp',
    region: 'Dhaulagiri', location: 'Dhaulagiri Base Camp, Myagdi',
    maxAltitude: 4750, durationDays: 12, priceNPR: 70000,
    keywords: ['glacier', 'remote', 'camping', 'challenging', 'wilderness'],
  },
  {
    id: '26', name: 'Dhaulagiri Hidden Wilderness',
    parentName: 'Dhaulagiri Circuit Trek', childRoute: 'Dhaulagiri Hidden Valley',
    region: 'Dhaulagiri', location: 'Hidden Valley & French Pass, Myagdi',
    maxAltitude: 5360, durationDays: 16, priceNPR: 90000,
    keywords: ['high pass', 'expedition', 'remote', 'technical', 'camping'],
  },
  {
    id: '27', name: 'Rolwaling Alpine Pass',
    parentName: 'Rolwaling Valley Trek', childRoute: 'Rolwaling Tashi Lapcha Pass',
    region: 'Rolwaling', location: 'Tashi Lapcha, Dolakha',
    maxAltitude: 5755, durationDays: 14, priceNPR: 80000,
    keywords: ['technical', 'glacier', 'expert', 'alpine', 'mountaineering'],
  },
  {
    id: '28', name: 'Rolwaling Hidden Valley',
    parentName: 'Rolwaling Valley Trek', childRoute: 'Rolwaling Classic',
    region: 'Rolwaling', location: 'Rolwaling Valley, Dolakha',
    maxAltitude: 4580, durationDays: 10, priceNPR: 50000,
    keywords: ['hidden', 'sacred', 'remote', 'quiet', 'nature'],
  },
  {
    id: '29', name: 'Makalu Sherpani Col Route',
    parentName: 'Makalu Base Camp Trek', childRoute: 'Makalu via Sherpani Col',
    region: 'Makalu', location: 'Sherpani Col, Barun Valley',
    maxAltitude: 6135, durationDays: 20, priceNPR: 140000,
    keywords: ['extreme', 'expert', 'technical', 'strenuous', 'remote-base-camp'],
  },
  {
    id: '30', name: 'Makalu Base Camp Classic',
    parentName: 'Makalu Base Camp Trek', childRoute: 'Makalu Classic Route',
    region: 'Makalu', location: 'Makalu Base Camp, Barun Valley',
    maxAltitude: 5000, durationDays: 14, priceNPR: 75000,
    keywords: ['wild', 'remote', 'nature', 'off-the-grid', 'massive-peaks'],
  },
];

export const TREK_METADATA: TrekMeta[] = RAW.map(raw => {
  const difficulty = difficultyFor(raw.maxAltitude);
  return {
    trekId: raw.id,
    name: raw.name,
    parentName: raw.parentName,
    childRoute: raw.childRoute,
    region: raw.region,
    location: raw.location,
    maxAltitude: raw.maxAltitude,
    difficulty,
    durationDays: raw.durationDays,
    priceNPR: raw.priceNPR,
    priceTier: priceTierFor(raw.priceNPR),
    keywords: raw.keywords,
    knnProfile: {
      ageGroup: idealBracketFor(difficulty),
      experienceLevel: experienceFor(difficulty),
      cardioFlag: 1,
      jointFlag: 1,
      altitudeHistory: altitudeHistoryFor(raw.maxAltitude),
    },
  };
});

export const TREK_BY_ID = new Map(TREK_METADATA.map(t => [t.trekId, t]));

/** Total number of official trekking destinations. */
export const TREK_COUNT = TREK_METADATA.length;

// ─── Catalogue-wide bounds, used to normalise the affinity layer ──────────────

export const PRICE_BOUNDS = {
  min: Math.min(...TREK_METADATA.map(t => t.priceNPR)),
  max: Math.max(...TREK_METADATA.map(t => t.priceNPR)),
};

export const DURATION_BOUNDS = {
  min: Math.min(...TREK_METADATA.map(t => t.durationDays)),
  max: Math.max(...TREK_METADATA.map(t => t.durationDays)),
};
