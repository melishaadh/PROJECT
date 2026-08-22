
import { Destination } from '@/data/destinations';

// ─── Region ───────────────────────────────────────────────────────────────────

export type Region =
  | 'Annapurna'
  | 'Everest'
  | 'Langtang'
  | 'Manaslu'
  | 'Mustang'
  | 'Dolpo'
  | 'Dhaulagiri'
  | 'Rolwaling'
  | 'Makalu';

/**
 * Trek family → region. Exhaustive over the catalogue's `parentName` values;
 * anything unrecognised falls through to `null` and is simply never matched by a
 * region-scoped query rather than being guessed at.
 */
const REGION_BY_FAMILY: Record<string, Region> = {
  'Annapurna Base Camp Trek': 'Annapurna',
  'Annapurna Circuit Trek': 'Annapurna',
  'Ghorepani Poon Hill Trek': 'Annapurna',
  'Mardi Himal Trek': 'Annapurna',
  'Everest Base Camp Trek': 'Everest',
  'Everest Three Passes Trek': 'Everest',
  'Gokyo Valley Trek': 'Everest',
  'Langtang Valley Trek': 'Langtang',
  'Helambu Trek': 'Langtang',
  'Manaslu Circuit Trek': 'Manaslu',
  'Upper Mustang Trek': 'Mustang',
  'Upper Dolpo Trek': 'Dolpo',
  'Dhaulagiri Circuit Trek': 'Dhaulagiri',
  'Rolwaling Valley Trek': 'Rolwaling',
  'Makalu Base Camp Trek': 'Makalu',
};

export function regionOf(trek: Destination): Region | null {
  return REGION_BY_FAMILY[trek.parentName] ?? null;
}

// ─── Gateway cities ───────────────────────────────────────────────────────────


const GATEWAY_BY_REGION: Record<Region, readonly string[]> = {
  Annapurna: ['pokhara'],
  Dhaulagiri: ['pokhara', 'beni'],
  Mustang: ['pokhara', 'jomsom'],
  Everest: ['kathmandu', 'lukla'],
  Langtang: ['kathmandu', 'syabrubesi', 'dhunche'],
  Manaslu: ['kathmandu', 'gorkha'],
  Rolwaling: ['kathmandu', 'dolakha'],
  Makalu: ['kathmandu', 'tumlingtar'],
  Dolpo: ['kathmandu', 'nepalgunj', 'juphal'],
};

/** Every gateway token the search lexicon should recognise. */
export const GATEWAY_TOKENS: readonly string[] = Array.from(
  new Set(Object.values(GATEWAY_BY_REGION).flat())
).sort();

/** True when `trek` is reached from the named gateway city. */
export function servesGateway(trek: Destination, gateway: string): boolean {
  const region = regionOf(trek);
  if (!region) return false;
  return GATEWAY_BY_REGION[region].includes(gateway);
}

// ─── Solo suitability ─────────────────────────────────────────────────────────


const RESTRICTED_REGIONS: readonly Region[] = ['Mustang', 'Dolpo', 'Manaslu'];


const TEAHOUSE_REGIONS: readonly Region[] = ['Annapurna', 'Everest', 'Langtang'];

/** Keywords that mark a route as needing a supported expedition, not a walk-in. */
const EXPEDITION_MARKERS = [
  'camping',
  'expedition',
  'technical',
  'mountaineering',
  'grueling',
  'gruelling',
];

/** Keywords that indicate lodging exists along the route. */
const LODGING_MARKERS = ['teahouse', 'lodge', 'homestay', 'guesthouse'];

function hasMarker(trek: Destination, markers: readonly string[]): boolean {
  return (trek.keywords ?? []).some(keyword => {
    const k = keyword.toLowerCase();
    return markers.some(marker => k.includes(marker));
  });
}

export interface SoloProfile {
  /** True when the route is one a trekker can realistically walk alone. */
  friendly: boolean;
  /** Why, in one phrase — for ranking transparency and future UI. */
  reason: string;
  /**
   * 0-1 confidence, used to *order* solo results so the most obviously
   * independent-friendly routes lead. Never used to exclude.
   */
  score: number;
}


export function soloProfileOf(trek: Destination): SoloProfile {
  const region = regionOf(trek);

  if (region && RESTRICTED_REGIONS.includes(region)) {
    return {
      friendly: false,
      reason: 'Restricted-area permit requires a guide and a party of two',
      score: 0,
    };
  }

  if (hasMarker(trek, EXPEDITION_MARKERS)) {
    return {
      friendly: false,
      reason: 'Needs expedition support — camping or technical ground',
      score: 0,
    };
  }

  const teahouseRegion = region !== null && TEAHOUSE_REGIONS.includes(region);
  if (!teahouseRegion && !hasMarker(trek, LODGING_MARKERS)) {
    return {
      friendly: false,
      reason: 'No continuous teahouse network along the route',
      score: 0,
    };
  }

  // Everything below qualifies. The score only orders the survivors.
  const altitudeEase = 1 - clamp01((trek.maxAltitude - 3000) / 2600);
  const durationEase = 1 - clamp01((trek.durationDays - 3) / 15);
  const gradeEase = trek.difficulty === 'Easy' ? 1 : trek.difficulty === 'Moderate' ? 0.6 : 0.25;

  return {
    friendly: true,
    reason: teahouseRegion
      ? 'Well-marked teahouse route with lodging throughout'
      : 'Lodging available along the route',
    score: clamp01(0.4 * gradeEase + 0.3 * altitudeEase + 0.3 * durationEase),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Convenience predicate for the search filter. */
export function isSoloFriendly(trek: Destination): boolean {
  return soloProfileOf(trek).friendly;
}

/** Solo ordering weight, 0 for routes that are not solo-friendly at all. */
export function soloScore(trek: Destination): number {
  return soloProfileOf(trek).score;
}
