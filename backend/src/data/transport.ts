/**
 * transport.ts
 *
 * How a traveller actually gets between a town and a trailhead.
 *
 * The itinerary engine has to connect the user's own start/finish to the
 * route's endpoints, and the mode it picks is not a cosmetic detail — it is the
 * difference between a 25-minute flight and a seven-hour mountain drive. The
 * previous model decided this with a single "are these the same city?" test and
 * called everything else a flight, which produced legs like *"Fly from Bamboo
 * to Pokhara"* for places that have no airstrip within a week's walk.
 *
 * The model here is deliberately small and explicit rather than clever:
 *
 *  • A **hub** is a place we actually know something about — where it is,
 *    whether a road reaches it, and whether it has a commercial airport.
 *  • A **flight is only ever offered between two hubs that both have airports
 *    and have a scheduled route between them.** Nothing is inferred; an air
 *    link that is not in `AIR_LEGS` does not exist.
 *  • A **drive is offered whenever a road can reach both ends.** Known pairs
 *    carry surveyed distances; unknown pairs fall back to a straight-line
 *    estimate inflated for hill switchbacks, which is rough but never absurd.
 *
 * Where both are possible the traveller gets both, because the choice is
 * genuinely theirs: the flight saves a day, the drive costs a tenth as much and
 * does not get cancelled by cloud. `recommended` marks the one the plan is
 * costed against, not the one the user must take.
 */

export type TransportMode = 'road_travel' | 'flight';

export interface TransportHub {
  /** Canonical display name. What the itinerary shows back to the user. */
  name: string;
  /**
   * Other spellings that mean this hub. Suburbs belong here when arriving at
   * them is, for planning purposes, arriving at the hub — Bhaktapur is inside
   * the Kathmandu valley, so no transfer leg is warranted between the two.
   */
  aliases?: string[];
  lat: number;
  lon: number;
  /** IATA code of the commercial airport serving this hub, when there is one. */
  airport?: string;
  /**
   * No motorable road reaches this place. Lukla is the canonical case: it is
   * reachable only by air or by several days of walking, so offering a drive
   * there is not a rough estimate, it is a fiction.
   */
  roadless?: boolean;
}

/**
 * Every place the planner can reason about concretely. The four trailheads the
 * catalogue actually starts and ends at — Kathmandu, Pokhara, Besisahar and
 * Lukla — plus the towns a user is realistically travelling *from*.
 */
export const TRANSPORT_HUBS: TransportHub[] = [
  {
    name: 'Kathmandu',
    aliases: [
      'bhaktapur', 'lalitpur', 'patan', 'kirtipur', 'tokha', 'budhanilkantha',
      'suryabinayak', 'madhyapur thimi', 'thamel', 'ktm',
    ],
    lat: 27.7172, lon: 85.324, airport: 'KTM',
  },
  { name: 'Pokhara', aliases: ['lekhnath'], lat: 28.2096, lon: 83.9856, airport: 'PKR' },
  { name: 'Besisahar', aliases: ['besi sahar'], lat: 28.2333, lon: 84.3833 },
  { name: 'Lukla', lat: 27.6869, lon: 86.7314, airport: 'LUA', roadless: true },

  { name: 'Chitwan', aliases: ['bharatpur', 'sauraha', 'narayangarh', 'narayangadh'], lat: 27.6768, lon: 84.4341, airport: 'BHR' },
  { name: 'Bhairahawa', aliases: ['siddharthanagar', 'lumbini'], lat: 27.5049, lon: 83.4501, airport: 'BWA' },
  { name: 'Nepalgunj', aliases: ['nepalganj'], lat: 28.05, lon: 81.6167, airport: 'KEP' },
  { name: 'Biratnagar', lat: 26.4525, lon: 87.2718, airport: 'BIR' },
  { name: 'Bhadrapur', aliases: ['kakarbhitta', 'birtamod'], lat: 26.5448, lon: 88.0798, airport: 'BDP' },
  { name: 'Janakpur', aliases: ['janakpurdham'], lat: 26.7288, lon: 85.9266, airport: 'JKR' },
  { name: 'Dhangadhi', lat: 28.6833, lon: 80.6, airport: 'DHI' },
  { name: 'Simara', aliases: ['birgunj'], lat: 27.1594, lon: 84.9803, airport: 'SIF' },
  { name: 'Surkhet', aliases: ['birendranagar'], lat: 28.6, lon: 81.6167, airport: 'SKH' },
  { name: 'Tumlingtar', lat: 27.315, lon: 87.1939, airport: 'TMI' },
  { name: 'Phaplu', aliases: ['salleri'], lat: 27.5175, lon: 86.5844, airport: 'PPL' },
  { name: 'Jomsom', lat: 28.7808, lon: 83.7228, airport: 'JMO' },
  { name: 'Juphal', aliases: ['dolpa', 'dunai'], lat: 28.9856, lon: 82.7936, airport: 'DOP' },

  { name: 'Butwal', lat: 27.7, lon: 83.45 },
  { name: 'Dharan', lat: 26.8167, lon: 87.2833 },
  { name: 'Hetauda', lat: 27.4287, lon: 85.0322 },
  { name: 'Syabrubesi', aliases: ['syabru besi', 'dhunche'], lat: 28.1642, lon: 85.3372 },
  { name: 'Jiri', lat: 27.6333, lon: 86.2333 },
];

/**
 * Surveyed road legs, keyed by the two hub names lowercased and sorted.
 *
 * Hours are realistic door-to-door times on Nepali highways — the Kathmandu to
 * Pokhara run is 200km and takes seven hours, and a plan that budgets three
 * because 200/65 says so puts the traveller on the trail after dark.
 */
const ROAD_LEGS: Record<string, { km: number; hours: number }> = {
  'kathmandu|pokhara': { km: 200, hours: 7 },
  'besisahar|kathmandu': { km: 175, hours: 6 },
  'besisahar|pokhara': { km: 80, hours: 3 },
  'kathmandu|syabrubesi': { km: 122, hours: 7 },
  'jiri|kathmandu': { km: 187, hours: 8 },
  'chitwan|kathmandu': { km: 150, hours: 5 },
  'chitwan|pokhara': { km: 155, hours: 5 },
  'bhairahawa|kathmandu': { km: 280, hours: 8 },
  'bhairahawa|pokhara': { km: 190, hours: 6 },
  'butwal|kathmandu': { km: 260, hours: 8 },
  'butwal|pokhara': { km: 175, hours: 5.5 },
  'kathmandu|nepalgunj': { km: 520, hours: 12 },
  'biratnagar|kathmandu': { km: 540, hours: 12 },
  'janakpur|kathmandu': { km: 225, hours: 6.5 },
  'kathmandu|simara': { km: 135, hours: 5 },
  'hetauda|kathmandu': { km: 132, hours: 4.5 },
  'dharan|kathmandu': { km: 500, hours: 11 },
  'jomsom|pokhara': { km: 160, hours: 9 },
  'juphal|nepalgunj': { km: 300, hours: 12 },
  'phaplu|kathmandu': { km: 265, hours: 10 },
  'tumlingtar|kathmandu': { km: 480, hours: 13 },
};

/**
 * Scheduled domestic air links, keyed the same way, valued in airborne minutes.
 * Nepal's network is hub-and-spoke out of Kathmandu with a single Pokhara spur,
 * and this table says so literally — if a pair is absent, there is no flight.
 */
const AIR_LEGS: Record<string, number> = {
  'kathmandu|pokhara': 25,
  'kathmandu|lukla': 35,
  'chitwan|kathmandu': 20,
  'bhairahawa|kathmandu': 35,
  'kathmandu|nepalgunj': 55,
  'biratnagar|kathmandu': 45,
  'bhadrapur|kathmandu': 55,
  'janakpur|kathmandu': 30,
  'dhangadhi|kathmandu': 75,
  'kathmandu|simara': 20,
  'kathmandu|surkhet': 60,
  'kathmandu|tumlingtar': 40,
  'kathmandu|phaplu': 30,
  'jomsom|pokhara': 20,
  'juphal|nepalgunj': 35,
};

/**
 * Ground time a flight costs on top of the airborne minutes: getting to the
 * terminal, the check-in window, and the transfer at the far end. Domestic
 * Nepali sectors are short enough that this dominates — a 25-minute hop to
 * Pokhara is most of a morning, and scheduling it as 0.4h would let the planner
 * stack a full trekking stage behind it on the same day.
 */
const AIRPORT_OVERHEAD_HOURS = 1.5;

/** Straight-line to road-distance multiplier. Nepali hill roads switchback. */
const DETOUR_FACTOR = 1.7;

/**
 * Estimating an unsurveyed drive. The constant term is the loading, tea stops
 * and town crawl that every Nepali road journey carries regardless of length;
 * without it a 60km hill hop comes out at an hour, which no such journey is.
 */
const ESTIMATE_KMH = 45;
const ESTIMATE_FIXED_HOURS = 1;

/**
 * A drive longer than this makes the flight the sensible default when one
 * exists — beyond roughly a working day on the road, the sector fare buys back
 * a trekking day rather than just some comfort.
 */
const FLIGHT_PREFERRED_ABOVE_HOURS = 5;

export interface TransferOption {
  mode: TransportMode;
  /** 0 for flights: air miles are not ground distance and must not be summed into one. */
  distanceKm: number;
  durationHours: number;
  /** Short line of context the UI shows under the option. */
  detail: string;
  /** Something the traveller would be annoyed to discover at the airport. */
  caution?: string;
  /** The option the itinerary is costed against. Exactly one is set. */
  recommended: boolean;
}

export interface TransferPlan {
  from: string;
  to: string;
  options: TransferOption[];
  /**
   * At least one endpoint is not a known hub, so the numbers are a placeholder
   * rather than an estimate. Callers surface this rather than presenting a made
   * up duration as fact.
   */
  approximate: boolean;
}

const HUB_BY_KEY = (() => {
  const map = new Map<string, TransportHub>();
  for (const hub of TRANSPORT_HUBS) {
    map.set(hub.name.toLowerCase(), hub);
    for (const alias of hub.aliases ?? []) map.set(alias, hub);
  }
  return map;
})();

/** The hub a free-text location refers to, if we know it at all. */
export function resolveHub(loc: string): TransportHub | undefined {
  return HUB_BY_KEY.get(loc.trim().toLowerCase());
}

/**
 * The name to show for a location: the hub's canonical spelling when we
 * recognise it, so "bhaktapur" plans and displays as Kathmandu, otherwise the
 * user's own text untouched.
 */
export function canonicalLocation(loc: string): string {
  return resolveHub(loc)?.name ?? loc.trim();
}

/**
 * True when two locations are close enough that no transfer leg is warranted —
 * the same hub, or two names for it.
 */
export function sameLocation(a: string, b: string): boolean {
  const hubA = resolveHub(a);
  const hubB = resolveHub(b);
  if (hubA && hubB) return hubA.name === hubB.name;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function legKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join('|');
}

function haversineKm(a: TransportHub, b: TransportHub): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function roadOption(from: TransportHub, to: TransportHub): TransferOption | null {
  if (from.roadless || to.roadless) return null;

  const surveyed = ROAD_LEGS[legKey(from.name, to.name)];
  const km = surveyed ? surveyed.km : Math.round(haversineKm(from, to) * DETOUR_FACTOR);
  const hours = surveyed
    ? surveyed.hours
    : round1(Math.max(0.5, km / ESTIMATE_KMH + ESTIMATE_FIXED_HOURS));

  return {
    mode: 'road_travel',
    distanceKm: km,
    durationHours: hours,
    detail: surveyed
      ? `${km} km by road — tourist bus, shared jeep or private car`
      : `About ${km} km by road (estimated)`,
    recommended: false,
  };
}

/** The one airport everything else in the network connects through. */
const AIR_NETWORK_HUB = 'Kathmandu';

function flightOption(from: TransportHub, to: TransportHub): TransferOption | null {
  if (!from.airport || !to.airport) return null;

  const direct = AIR_LEGS[legKey(from.name, to.name)];

  // No direct sector, but the network is hub-and-spoke: if both ends fly to
  // Kathmandu, the journey is a connection rather than an impossibility. This
  // is what makes Pokhara → Lukla answerable at all.
  const viaOut = AIR_LEGS[legKey(from.name, AIR_NETWORK_HUB)];
  const viaIn = AIR_LEGS[legKey(AIR_NETWORK_HUB, to.name)];
  const connects =
    !direct && !!viaOut && !!viaIn
    && from.name !== AIR_NETWORK_HUB && to.name !== AIR_NETWORK_HUB;

  if (!direct && !connects) return null;

  const minutes = direct ?? viaOut + viaIn;
  const option: TransferOption = {
    mode: 'flight',
    distanceKm: 0,
    // A connection costs a second round of airport time, and in Nepal it
    // usually costs an overnight too — the onward sectors go in the morning.
    durationHours: round1(minutes / 60 + AIRPORT_OVERHEAD_HOURS * (direct ? 1 : 2)),
    detail: direct
      ? `${minutes} min in the air (${from.airport} → ${to.airport}), plus airport time`
      : `Connecting via ${AIR_NETWORK_HUB} (${from.airport} → ${to.airport}), ${minutes} min airborne`,
    recommended: false,
  };

  // Lukla is the one sector where the published departure point moves. During
  // the spring and autumn peaks the flights run out of Manthali instead, and a
  // traveller who budgeted a Kathmandu morning discovers a 4am drive.
  if (from.name === 'Lukla' || to.name === 'Lukla') {
    option.caution =
      'In peak season Lukla flights operate from Manthali (Ramechhap), a 4–5 h drive from Kathmandu. Weather delays are common — keep a spare day.';
  }

  return option;
}

/**
 * Work out how to get from one place to another.
 *
 * Returns `null` when the two are the same place and no leg is needed. Never
 * returns an empty option list: if nothing is known, the caller still gets a
 * road leg flagged `approximate` so the plan says "arrange this locally"
 * instead of inventing a flight.
 */
export function planTransfer(from: string, to: string): TransferPlan | null {
  if (!from.trim() || !to.trim()) return null;
  if (sameLocation(from, to)) return null;

  const fromName = canonicalLocation(from);
  const toName = canonicalLocation(to);
  const fromHub = resolveHub(from);
  const toHub = resolveHub(to);

  if (!fromHub || !toHub) {
    return {
      from: fromName,
      to: toName,
      approximate: true,
      options: [
        {
          mode: 'road_travel',
          distanceKm: 0,
          durationHours: 4,
          detail: 'No scheduled service on record — arrange this leg locally.',
          recommended: true,
        },
      ],
    };
  }

  const road = roadOption(fromHub, toHub);
  const flight = flightOption(fromHub, toHub);
  const options = [flight, road].filter((o): o is TransferOption => o !== null);

  if (options.length === 0) {
    // Both hubs known, but roadless and with no air link between them. Honest
    // fallback rather than a fabricated leg.
    return {
      from: fromName,
      to: toName,
      approximate: true,
      options: [
        {
          mode: 'road_travel',
          distanceKm: 0,
          durationHours: 6,
          detail: 'No direct road or flight — this leg has to be walked or chartered.',
          recommended: true,
        },
      ],
    };
  }

  const preferFlight = !!flight && (!road || road.durationHours > FLIGHT_PREFERRED_ABOVE_HOURS);
  const chosen = preferFlight ? flight! : road ?? flight!;
  chosen.recommended = true;

  return { from: fromName, to: toName, options, approximate: false };
}
