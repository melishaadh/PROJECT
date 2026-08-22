import { CacheService } from '@/common/cache.service';
import { TREK_BY_ID, TREK_METADATA } from '@/data/trek-metadata';
import {
  AGE_BRACKETS,
  MAX_PEER_BRACKET_GAP,
  ageGroupFromAge,
  ageGroupFromDob,
} from '@/common/age';
import {
  BEHAVIOURAL_TRIGGER_LIKES,
  COLD_START_FEED_SIZE,
  RecommendationsService,
} from './recommendations.service';

/**
 * Behavioural contract for the For You engine.
 *
 * Every layer is exercised against in-memory stubs rather than Mongo, because
 * what needs guarding here is the *ranking behaviour*, not the persistence: the
 * requirements this suite encodes ("two likes must move the feed", "liking
 * Annapurna must surface the rest of Annapurna", "a thin cold-start
 * intersection must still fill the feed") are all statements about the order of
 * a returned list, and they are the things a well-meaning tweak to a weight
 * silently breaks.
 *
 * The stubs mirror the real services exactly where it matters: `getUserLikes`
 * returns most-recent-first (the real query sorts `interactedAt: -1`, and the
 * affinity decay depends on that order), and `catalogue()` returns empty so the
 * service falls through to the bundled `TREK_METADATA` — the same 30 routes the
 * seeder writes.
 */

const OPEN_PREFS = { maxDuration: 21, maxPrice: 300_000, difficulty: 'All' };
const HEALTHY = { ageGroup: 1, experienceLevel: 2, cardioFlag: 1, jointFlag: 1, altitudeHistory: 2 };

interface StubUser {
  id: string;
  dateOfBirth: string | null;
  profile: Record<string, number>;
  preferences: Record<string, unknown>;
  completedTrekIds?: string[];
  likes?: string[];
  /** Passive micro-interactions: dwell time and scroll-past dismissals. */
  signals?: { trekId: string; type: 'view' | 'dismiss'; count: number; dwellMs: number }[];
}

/** A DOB that lands the account on `age` today, whenever today is. */
function dobForAge(age: number): string {
  const now = new Date();
  return new Date(now.getFullYear() - age, now.getMonth(), now.getDate() - 1)
    .toISOString()
    .slice(0, 10);
}

function buildWorld(users: StubUser[]) {
  const likeRows = users.flatMap(u =>
    (u.likes ?? []).map(trekId => ({ userId: u.id, trekId, type: 'like', ratingValue: null }))
  );

  const usersService = {
    async findById(id: string) {
      const u = users.find(x => x.id === id);
      return u
        ? {
            profile: u.profile,
            preferences: u.preferences,
            dateOfBirth: u.dateOfBirth,
            completedTrekIds: u.completedTrekIds ?? [],
          }
        : null;
    },
    async getAllProfiles() {
      // Mirrors the real query, which re-derives every peer's bracket from their
      // own date of birth rather than trusting the number frozen in their
      // document. The strict clustering compares *live* brackets, so a stub that
      // handed back the stored value would be testing a different rule.
      return users.map(u => ({
        userId: u.id,
        profile: { ...u.profile, ageGroup: ageGroupFromDob(u.dateOfBirth, u.profile?.ageGroup ?? 1) },
        preferences: u.preferences,
      }));
    },
    async getAllInteractions() {
      return likeRows;
    },
    async getAllLikeCounts() {
      const counts: Record<string, number> = {};
      for (const t of TREK_METADATA) counts[t.trekId] = 0;
      for (const row of likeRows) counts[row.trekId] += 1;
      return counts;
    },
    async getUserLikes(userId: string) {
      const u = users.find(x => x.id === userId);
      return [...(u?.likes ?? [])].reverse().map(trekId => ({ trekId }));
    },
    async getUserSignals(userId: string) {
      return users.find(x => x.id === userId)?.signals ?? [];
    },
  };

  const cache = new CacheService();
  const service = new RecommendationsService(
    usersService as any,
    {
      async catalogue() { return [] as any[] },
      // The engine asks Mongo for the candidate set with `$nin` rather than
      // filtering after the fact. An empty result here is the "collection not
      // reachable / not seeded" path, which falls through to the bundled
      // `TREK_METADATA` — with the same exclusion applied in memory, so the
      // stub exercises the degraded branch without weakening the rule.
      async catalogueExcluding() { return [] as any[] },
    } as any,
    cache
  );
  return { service, cache };
}

const regionOf = (trekId: string) => TREK_BY_ID.get(trekId)?.region ?? '';
const idsIn = (region: string) =>
  TREK_METADATA.filter(t => t.region === region).map(t => t.trekId);

/** A representative age inside a bracket, for building peers by cohort. */
const ageInBracket = (index: number) => AGE_BRACKETS[index].minAge + 1;

describe('the tailored age brackets', () => {
  it('maps every boundary age to the bracket the preference form advertises', () => {
    for (const bracket of AGE_BRACKETS) {
      expect(ageGroupFromAge(bracket.minAge)).toBe(bracket.index);
      if (bracket.maxAge !== null) {
        expect(ageGroupFromAge(bracket.maxAge)).toBe(bracket.index);
        // The next year belongs to the next cohort — no gaps, no overlaps.
        expect(ageGroupFromAge(bracket.maxAge + 1)).toBe(bracket.index + 1);
      }
    }
  });

  it('covers the five named cohorts with the exact advertised ranges', () => {
    expect(AGE_BRACKETS.map(b => [b.label, b.rangeLabel])).toEqual([
      ['Gen-Z Explorers', '18 – 23'],
      ['Young Professionals', '24 – 29'],
      ['Active Adventurers', '30 – 35'],
      ['Experienced Trekkers', '36 – 41'],
      ['Seasoned Explorers', '42 – 50+'],
    ]);
  });

  it('keeps the top bracket open-ended and clamps below the floor', () => {
    expect(ageGroupFromAge(50)).toBe(4);
    expect(ageGroupFromAge(72)).toBe(4);
    // Below the 18 floor there is no cohort to fall into; clamping keeps such
    // an account inside the system rather than bracketless.
    expect(ageGroupFromAge(15)).toBe(0);
  });
});

describe('RecommendationsService — For You feed', () => {
  describe('cold start (0 interactions)', () => {
    it('serves a curated, non-empty feed driven by the onboarding form', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.coldStart).toBe(true);
      expect(feed.recommended).toHaveLength(COLD_START_FEED_SIZE);
      expect(feed.affinity.active).toBe(false);
      expect(feed.affinity.behaviouralTriggered).toBe(false);
      // The stated budget and duration are a hard gate before any like exists.
      for (const id of feed.order) {
        expect(TREK_BY_ID.get(id)!.priceNPR).toBeLessThanOrEqual(300_000);
        expect(TREK_BY_ID.get(id)!.durationDays).toBeLessThanOrEqual(21);
      }
    });

    it('honours the stated difficulty as a hard filter, not a preference', async () => {
      const { service } = buildWorld([
        {
          id: 'u1',
          dateOfBirth: dobForAge(30),
          profile: HEALTHY,
          preferences: { ...OPEN_PREFS, difficulty: 'Moderate' },
        },
      ]);
      const feed = await service.getForYou('u1');
      const moderateCount = TREK_METADATA.filter(t => t.difficulty === 'Moderate').length;

      // Everything the form asked for leads; only the surplus slots widen.
      expect(
        feed.order.slice(0, Math.min(moderateCount, feed.order.length)).every(
          id => TREK_BY_ID.get(id)!.difficulty === 'Moderate'
        )
      ).toBe(true);
    });

    it('reports the tailored bracket the feed was clustered on', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(26), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.ageBracket).toMatchObject({
        index: 1,
        key: 'young-professionals',
        label: 'Young Professionals',
        rangeLabel: '24 – 29',
        derived: true,
      });
    });

    it('pads a thin intersection from the trending leaderboard rather than short-changing the feed', async () => {
      // A Seasoned Explorer asking for Easy routes only: the catalogue holds
      // three, and the two peers who *have* liked things are two brackets away,
      // so the cohort stages are empty too — the profile-driven stages cannot
      // fill six slots between them.
      const { service } = buildWorld([
        {
          id: 'u1',
          dateOfBirth: dobForAge(46),
          profile: { ...HEALTHY, ageGroup: 4 },
          preferences: { ...OPEN_PREFS, difficulty: 'Easy' },
        },
        { id: 'p1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['3', '11'] },
        { id: 'p2', dateOfBirth: dobForAge(31), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['3'] },
      ]);

      const feed = await service.getForYou('u1');
      const easyIds = TREK_METADATA.filter(t => t.difficulty === 'Easy').map(t => t.trekId);

      expect(feed.ageBracket.label).toBe('Seasoned Explorers');
      expect(feed.recommended).toHaveLength(COLD_START_FEED_SIZE);
      expect(feed.trendingPadding).toBeGreaterThan(0);
      // No cohort to draw on: both peers sit two brackets away.
      expect(feed.cohort.excludedByAgeGap).toBe(2);
      expect(feed.peerBracketSlots).toBe(0);
      // The exact intersection still leads.
      expect(feed.order.slice(0, easyIds.length).every(id => easyIds.includes(id))).toBe(true);
      // And the padding is the leaderboard the Explore tab renders.
      const leaderboard = await service.getTrending(3);
      expect(leaderboard[0].trekId).toBe('3');
      expect(feed.order).toContain('3');
    });

    it('keeps the form ∩ bracket intersection ahead of every widening stage', async () => {
      const { service } = buildWorld([
        {
          id: 'u1',
          dateOfBirth: dobForAge(46),
          profile: { ...HEALTHY, ageGroup: 4 },
          preferences: { ...OPEN_PREFS, difficulty: 'Easy' },
        },
      ]);
      const feed = await service.getForYou('u1');
      const easyIds = TREK_METADATA.filter(t => t.difficulty === 'Easy').map(t => t.trekId);
      // Every Easy route is present before anything harder appears.
      const firstHarder = feed.order.findIndex(id => !easyIds.includes(id));
      expect(firstHarder).toBe(easyIds.length);
    });

    it('surfaces what the user’s own bracket likes, ahead of the generic widening', async () => {
      // A brand-new Gen-Z Explorer. Two peers in the same bracket have liked a
      // Langtang route each; nobody else comparable has liked anything.
      const langtang = idsIn('Langtang')[0];
      const genZ = ageInBracket(0);
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(genZ), profile: HEALTHY, preferences: OPEN_PREFS },
        { id: 'peerA', dateOfBirth: dobForAge(genZ), profile: HEALTHY, preferences: OPEN_PREFS, likes: [langtang] },
        { id: 'peerB', dateOfBirth: dobForAge(genZ + 1), profile: HEALTHY, preferences: OPEN_PREFS, likes: [langtang] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.coldStart).toBe(true);
      // No likes of its own, so no collaborative weight — but the cohort still
      // shapes which routes fill the cold-start pool.
      expect(feed.weights.collaborative).toBe(0);
      expect(feed.cohort.sameBracket).toBe(2);
      expect(feed.peerBracketSlots).toBeGreaterThan(0);
      expect(feed.order[0]).toBe(langtang);
    });

    it('ignores what a distant bracket likes when filling a new account’s feed', async () => {
      const langtang = idsIn('Langtang')[0];
      const genZ = ageInBracket(0);
      const seasoned = ageInBracket(4);
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(genZ), profile: HEALTHY, preferences: OPEN_PREFS },
        // Four brackets away — an unrealistic peer, however busy.
        { id: 'far1', dateOfBirth: dobForAge(seasoned), profile: HEALTHY, preferences: OPEN_PREFS, likes: [langtang] },
        { id: 'far2', dateOfBirth: dobForAge(seasoned + 2), profile: HEALTHY, preferences: OPEN_PREFS, likes: [langtang] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.cohort.candidates).toBe(0);
      expect(feed.cohort.excludedByAgeGap).toBe(2);
      // Nothing in this feed was placed by the cohort. The route may still show
      // up — it is genuinely the most-liked route in the catalogue, and the
      // global popularity layer is allowed to say so — but no slot was awarded
      // to it on the grounds that "people like you" walked it, because nobody
      // like this user has.
      expect(feed.peerBracketSlots).toBe(0);
    });
  });

  describe(`the ${BEHAVIOURAL_TRIGGER_LIKES}-like behavioural trigger`, () => {
    it('stays in cold start at one like but already learns from it', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.coldStart).toBe(true);
      expect(feed.affinity.active).toBe(true);
      expect(feed.affinity.behaviouralTriggered).toBe(false);
      expect(feed.weights.affinity).toBeGreaterThan(0);
      expect(feed.weights.affinity).toBeLessThan(0.35);
    });

    it('fires at the second like and puts the behavioural layer at full weight', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.coldStart).toBe(false);
      expect(feed.affinity.behaviouralTriggered).toBe(true);
      expect(feed.weights.affinity).toBeCloseTo(0.35, 10);
      expect(feed.recommended.length).toBeGreaterThan(COLD_START_FEED_SIZE);
    });

    it('re-indexes with no manual refresh once the like write invalidates the cache', async () => {
      const user: StubUser = {
        id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: [],
      };
      const { service, cache } = buildWorld([user]);

      const before = await service.getForYou('u1');
      // A repeat read inside the TTL is the cached ranking.
      expect((await service.getForYou('u1')).order).toEqual(before.order);

      // Two heart taps: the like path writes, then invalidates write-through.
      user.likes = ['1', '2'];
      cache.invalidate('likes', 'user:u1');

      const after = await service.getForYou('u1');
      expect(after.order).not.toEqual(before.order);
      expect(before.coldStart).toBe(true);
      expect(after.coldStart).toBe(false);
      expect(after.affinity.affineRegions).toContain('Annapurna');
    });
  });

  describe('multi-attribute affinity', () => {
    it('surfaces the unexplored remainder of a liked region', async () => {
      const { service } = buildWorld([
        // Classic ABC + Poon Hill Panorama ABC — both Annapurna.
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2'] },
      ]);
      const feed = await service.getForYou('u1');
      const surfaced = feed.order.filter(id => regionOf(id) === 'Annapurna');

      expect(feed.affinity.affineRegions).toContain('Annapurna');
      expect(surfaced.filter(id => id !== '1' && id !== '2').length).toBeGreaterThanOrEqual(2);
      // The two routes already liked are demoted out of the top slot.
      expect(feed.order[0]).not.toBe('1');
      expect(feed.order[0]).not.toBe('2');
    });

    it('holds two regions at once instead of picking a winner', async () => {
      const everest = idsIn('Everest')[0];
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30),
          profile: { ...HEALTHY, altitudeHistory: 3 },
          preferences: OPEN_PREFS,
          likes: ['1', everest],
        },
      ]);
      const feed = await service.getForYou('u1');
      const regions = new Set(feed.order.map(regionOf));

      expect(feed.affinity.affineRegions).toEqual(expect.arrayContaining(['Annapurna', 'Everest']));
      expect(regions.has('Annapurna')).toBe(true);
      expect(regions.has('Everest')).toBe(true);
      // …and has not collapsed into just those two — discovery survives.
      expect(regions.size).toBeGreaterThanOrEqual(3);
    });

    it('learns the exact price and duration bands, not just a mean', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '3'] },
      ]);
      const feed = await service.getForYou('u1');
      const a = TREK_BY_ID.get('1')!;
      const b = TREK_BY_ID.get('3')!;

      expect(feed.affinity.priceRange).toEqual({
        min: Math.min(a.priceNPR, b.priceNPR),
        max: Math.max(a.priceNPR, b.priceNPR),
      });
      expect(feed.affinity.durationRange).toEqual({
        min: Math.min(a.durationDays, b.durationDays),
        max: Math.max(a.durationDays, b.durationDays),
      });
    });

    it('tracks difficulty tiers and semantic keyword tokens', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.affinity.dominantDifficulty).toBe(TREK_BY_ID.get('1')!.difficulty);
      expect(Object.keys(feed.affinity.keywordWeights).length).toBeGreaterThan(0);
      // Tokens shared by the two liked ABC routes must be present and heavy.
      expect(feed.affinity.keywordWeights['annapurna']).toBeGreaterThan(0);
    });

    it('folds the profile’s completed treks into the long-term weights', async () => {
      const langtang = idsIn('Langtang').slice(0, 2);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: langtang,
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.affinity.active).toBe(true);
      expect(feed.affinity.completedSampleSize).toBe(2);
      expect(feed.affinity.affineRegions).toContain('Langtang');
      expect(feed.weights.affinity).toBeGreaterThan(0);
      // History informs the ranking without ending cold start — no likes yet.
      expect(feed.coldStart).toBe(true);
      // And a route already walked never takes the top slot.
      expect(langtang).not.toContain(feed.order[0]);
    });
  });

  /**
   * Completed treks are removed from the feed but kept as a ranking signal.
   * The two halves have to hold together: dropping the signal as well would
   * turn "I've walked two Annapurna routes" into no information at all, and
   * keeping the routes in the output re-offers finished adventures.
   */
  describe('completed treks are excluded from the feed', () => {
    it('never recommends a route the user has already walked', async () => {
      const walked = idsIn('Annapurna').slice(0, 3);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: walked,
        },
      ]);
      const feed = await service.getForYou('u1');

      for (const id of walked) expect(feed.order).not.toContain(id);
      expect(feed.excludedAsCompleted).toBe(walked.length);
      expect(feed.order.length).toBeGreaterThan(0);
    });

    it('still lets the completed history pull its own region up the feed', async () => {
      const walked = idsIn('Everest').slice(0, 2);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: walked,
        },
      ]);
      const feed = await service.getForYou('u1');

      // The walked routes are gone, but the rest of Everest is surfaced.
      for (const id of walked) expect(feed.order).not.toContain(id);
      const unexploredEverest = idsIn('Everest').filter(id => !walked.includes(id));
      expect(feed.order.some(id => unexploredEverest.includes(id))).toBe(true);
      expect(feed.affinity.affineRegions).toContain('Everest');
    });

    it('excludes only completed routes, not merely liked ones', async () => {
      const [likedId, completedId] = [idsIn('Langtang')[0], idsIn('Manaslu')[0]];
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          likes: [likedId, idsIn('Langtang')[1]],
          completedTrekIds: [completedId],
        },
      ]);
      const feed = await service.getForYou('u1');

      // A like is aspirational and stays eligible (demoted); a completed trek
      // is finished and is removed outright.
      expect(feed.order).not.toContain(completedId);
      expect(feed.excludedAsCompleted).toBe(1);
    });

    /**
     * The exclusion is absolute — there is no thin-inventory backfill.
     *
     * This used to assert the opposite: once exclusion could no longer fill the
     * window, completed routes were re-appended behind everything unexplored so
     * the feed never shrank. That made the rule conditional, and a conditional
     * "never recommends what you have walked" is not the rule. A completionist
     * now gets a short feed — or none — which is the honest answer.
     */
    it('returns a shorter feed rather than re-offering a completed trek', async () => {
      const all = TREK_METADATA.map(t => t.trekId);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: all,
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.order).toEqual([]);
      expect(feed.excludedAsCompleted).toBe(all.length);
    });

    it('keeps the feed full of unwalked routes when inventory is merely thin', async () => {
      // 26 of 30 walked: fewer routes remain than a full window, so every
      // padding stage runs — and none of them may reach for a completed trek.
      const walked = TREK_METADATA.slice(0, 26).map(t => t.trekId);
      const remaining = TREK_METADATA.slice(26).map(t => t.trekId);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: walked,
        },
      ]);
      const feed = await service.getForYou('u1');

      // Below COLD_START_BLEND_FLOOR, so the 50/50 peer-and-trending blend is
      // exactly what filled these slots — from unwalked inventory only.
      expect(feed.coldStart).toBe(true);
      expect(feed.order.length).toBeGreaterThan(0);
      expect(feed.order.every(id => remaining.includes(id))).toBe(true);
      expect(feed.excludedAsCompleted).toBe(walked.length);
    });
  });

  /**
   * The catalogue nests sub-routes under a parent family: "Gokyo Lakes & EBC"
   * and "Everest Base Camp Classic" are both children of "Everest Base Camp
   * Trek". Completing one child is a statement about that route only.
   */
  describe('parent family vs. specific sub-route', () => {
    /** A family with more than one child, and its member ids. */
    const FAMILY = 'Everest Base Camp Trek';
    const familyIds = TREK_METADATA.filter(t => t.parentName === FAMILY).map(t => t.trekId);

    it('has a multi-child family to reason about', () => {
      expect(familyIds.length).toBeGreaterThan(1);
    });

    it('retires the completed sub-route and leaves its siblings recommendable', async () => {
      const [walked, ...siblings] = familyIds;
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: [walked],
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.order).not.toContain(walked);
      // The sibling is not merely un-blocked — completing its parent family's
      // other route pulls the region up, so it is actually in the feed.
      expect(siblings.some(id => feed.order.includes(id))).toBe(true);
      // One route retired, not a family.
      expect(feed.excludedAsCompleted).toBe(1);
      expect(feed.completedFamilies).toEqual([]);
    });

    it('reports the family as complete only once every child is walked', async () => {
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: familyIds,
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.completedFamilies).toContain(FAMILY);
      for (const id of familyIds) expect(feed.order).not.toContain(id);
      // Every *other* family is untouched — a completed family removes its own
      // children and nothing else.
      const otherRegions = TREK_METADATA.filter(t => t.parentName !== FAMILY);
      expect(feed.order.every(id => otherRegions.some(t => t.trekId === id))).toBe(true);
    });

    it('never lets a completed sub-route filter its siblings by region', async () => {
      // Completing one route in a region must not remove the region. Everest
      // holds several families; walking one route from one of them leaves the
      // rest of the region eligible.
      const walked = idsIn('Everest')[0];
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: [walked],
        },
      ]);
      const feed = await service.getForYou('u1');

      const otherEverest = idsIn('Everest').filter(id => id !== walked);
      expect(feed.order.some(id => otherEverest.includes(id))).toBe(true);
    });
  });

  /**
   * Passive signals are inferred intent. Every assertion here is as much about
   * what they must NOT do — outvote an explicit preference — as what they do.
   */
  describe('micro-interaction sentiment weighting', () => {
    const HIGH_DWELL = 9_000;

    it('lifts a route the user lingered on', async () => {
      const target = idsIn('Manaslu')[0];
      const base = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const withDwell = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          signals: [{ trekId: target, type: 'view', count: 1, dwellMs: HIGH_DWELL }],
        },
      ]);

      const before = (await base.service.getForYou('u1')).order.indexOf(target);
      const after = (await withDwell.service.getForYou('u1')).order.indexOf(target);

      expect(after).toBeGreaterThanOrEqual(0);
      expect(after).toBeLessThanOrEqual(before === -1 ? Infinity : before);
    });

    it('ignores a glance too short to mean anything', async () => {
      const target = idsIn('Manaslu')[0];
      const plain = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const glanced = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          // 300ms — the card passing under the viewport mid-scroll.
          signals: [{ trekId: target, type: 'view', count: 1, dwellMs: 300 }],
        },
      ]);

      expect((await glanced.service.getForYou('u1')).order)
        .toEqual((await plain.service.getForYou('u1')).order);
    });

    it('downranks a dismissed route and cools its whole category', async () => {
      const everest = idsIn('Everest');
      const plain = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const dismissive = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          signals: everest.slice(0, 3).map(trekId => ({
            trekId, type: 'dismiss' as const, count: 4, dwellMs: 0,
          })),
        },
      ]);

      const before = (await plain.service.getForYou('u1')).order;
      const after = (await dismissive.service.getForYou('u1')).order;

      const everestBefore = before.filter(id => everest.includes(id)).length;
      const everestAfter = after.filter(id => everest.includes(id)).length;
      // The dismissed routes themselves, and their region, lose ground.
      expect(everestAfter).toBeLessThanOrEqual(everestBefore);
      for (const id of everest.slice(0, 3)) {
        const wasAt = before.indexOf(id);
        const nowAt = after.indexOf(id);
        if (wasAt !== -1 && nowAt !== -1) expect(nowAt).toBeGreaterThanOrEqual(wasAt);
      }
    });

    it('never lets passive negatives empty the feed', async () => {
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          signals: TREK_METADATA.map(t => ({
            trekId: t.trekId, type: 'dismiss' as const, count: 50, dwellMs: 0,
          })),
        },
      ]);
      const feed = await service.getForYou('u1');
      expect(feed.order.length).toBeGreaterThan(0);
    });
  });

  describe('dynamic difficulty progression', () => {
    it('promotes the gentlest routes of the next tier once a tier is cleared', async () => {
      // Four Easy treks completed → Moderate unlocks.
      const easy = TREK_METADATA.filter(t => t.difficulty === 'Easy').map(t => t.trekId);
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: easy,
        },
      ]);
      const feed = await service.getForYou('u1');

      const gentlestModerate = TREK_METADATA
        .filter(t => t.difficulty === 'Moderate')
        .sort((a, b) => a.maxAltitude - b.maxAltitude)
        .slice(0, 3)
        .map(t => t.trekId);

      expect(feed.order.some(id => gentlestModerate.includes(id))).toBe(true);
    });

    it('does not unlock a tier from a single outlier trek', async () => {
      const easy = TREK_METADATA.filter(t => t.difficulty === 'Easy').map(t => t.trekId);
      const hardest = TREK_METADATA
        .filter(t => t.difficulty === 'Hard')
        .sort((a, b) => b.maxAltitude - a.maxAltitude)[0].trekId;

      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          // Mostly easy with one hard outlier — average stays near Easy.
          completedTrekIds: [...easy, hardest],
        },
      ]);
      // Must not throw and must still produce a coherent feed.
      const feed = await service.getForYou('u1');
      expect(feed.order.length).toBeGreaterThan(0);
    });
  });

  describe('explanation chips', () => {
    it('explains a route by its parent region, not the route that earned it', async () => {
      const langtang = idsIn('Langtang');
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          completedTrekIds: [langtang[0]],
        },
      ]);
      const feed = await service.getForYou('u1');
      const sibling = feed.recommended.find(r => langtang.includes(r.trekId));

      expect(sibling?.reason).toBe('More from Langtang Region');
    });

    /**
     * The chip must never quote the user's own history back at them by name.
     * Sub-route titles are also far too long to render at chip size.
     */
    it('never names a specific route in a chip', async () => {
      const everest = idsIn('Everest');
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          likes: everest.slice(0, 2),
          completedTrekIds: idsIn('Annapurna').slice(0, 2),
        },
      ]);
      const feed = await service.getForYou('u1');
      const routeNames = TREK_METADATA.map(t => t.name);

      for (const row of feed.recommended) {
        const reason = row.reason ?? '';
        for (const name of routeNames) {
          expect(reason).not.toContain(name);
        }
        // And no leftovers from the older phrasings.
        expect(reason).not.toMatch(/Because you (liked|completed) /);
      }
    });

    it('keeps chips short enough to render on a card', async () => {
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS,
          likes: idsIn('Everest').slice(0, 2),
          completedTrekIds: idsIn('Langtang').slice(0, 1),
        },
      ]);
      const feed = await service.getForYou('u1');

      for (const row of feed.recommended) {
        expect((row.reason ?? '').length).toBeLessThanOrEqual(34);
      }
    });

    it('gives every recommended route some reason at cold start', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.recommended.length).toBeGreaterThan(0);
      for (const row of feed.recommended) {
        expect(typeof row.reason).toBe('string');
        expect(row.reason!.length).toBeGreaterThan(0);
      }
    });

    /** The cohort exists in the engine; its *name* must never reach the UI. */
    it('never names an age cohort in a reason string', async () => {
      const cohortNames = AGE_BRACKETS.map(b => b.label);
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(20), profile: HEALTHY, preferences: OPEN_PREFS },
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `p${i}`, dateOfBirth: dobForAge(21), profile: HEALTHY,
          preferences: OPEN_PREFS, likes: idsIn('Everest').slice(0, 2),
        })),
      ]);
      const feed = await service.getForYou('u1');

      for (const row of feed.recommended) {
        for (const name of cohortNames) {
          expect(row.reason ?? '').not.toContain(name);
        }
      }
    });
  });

  describe('collaborative peer-filtering & strict age-bracket clustering', () => {
    it('amplifies a peer in the identical age bracket with an overlapping like', async () => {
      const dolpo = idsIn('Dolpo')[0];
      const genZ = { ...HEALTHY, ageGroup: 0, altitudeHistory: 3 };
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(22), profile: genZ, preferences: OPEN_PREFS, likes: ['1', '2'] },
        // Same bracket, shares like '1' → the cohort.
        { id: 'cohort', dateOfBirth: dobForAge(23), profile: genZ, preferences: OPEN_PREFS, likes: ['1', dolpo] },
        // Four brackets away → excluded from the corpus entirely, not merely
        // outranked, so its likes can never reach this feed.
        { id: 'far', dateOfBirth: dobForAge(64), profile: { ...HEALTHY, ageGroup: 4 }, preferences: OPEN_PREFS, likes: ['30'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.cohort.candidates).toBe(1);
      expect(feed.cohort.matched).toBe(1);
      expect(feed.cohort.sameBracket).toBe(1);
      expect(feed.cohort.excludedByAgeGap).toBe(1);
      expect(feed.weights.collaborative).toBeGreaterThan(0);
      expect(feed.order).toContain(dolpo);
    });

    it('counts an adjacent bracket as a peer, and anything further as an age gap', async () => {
      const activeAdventurer = ageInBracket(2);
      const langtang = idsIn('Langtang')[0];
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(activeAdventurer), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2'] },
        // One bracket below and one above → both eligible, at half bracket
        // weight. Each carries a route the user has *not* seen, so there is
        // something for the collaborative layer to actually recommend.
        { id: 'below', dateOfBirth: dobForAge(ageInBracket(1)), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', langtang] },
        { id: 'above', dateOfBirth: dobForAge(ageInBracket(3)), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['2', langtang] },
        // Two brackets below and two above → both dropped.
        { id: 'tooYoung', dateOfBirth: dobForAge(ageInBracket(0)), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1'] },
        { id: 'tooOld', dateOfBirth: dobForAge(ageInBracket(4)), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(MAX_PEER_BRACKET_GAP).toBe(1);
      expect(feed.cohort.candidates).toBe(2);
      expect(feed.cohort.sameBracket).toBe(0);
      expect(feed.cohort.adjacentBracket).toBe(2);
      expect(feed.cohort.excludedByAgeGap).toBe(2);
      // Adjacent peers are real peers: they still carry collaborative weight.
      expect(feed.weights.collaborative).toBeGreaterThan(0);
    });

    it('never lets a shared like bridge an unrealistic age gap', async () => {
      const dolpo = idsIn('Dolpo')[0];
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(19),
          profile: { ...HEALTHY, ageGroup: 0, altitudeHistory: 3 },
          preferences: OPEN_PREFS, likes: ['1', '2'],
        },
        // Identical likes *and* a distinctive extra one — the strongest possible
        // Jaccard overlap — but three brackets away.
        {
          id: 'perfectButFar', dateOfBirth: dobForAge(48),
          profile: { ...HEALTHY, ageGroup: 4, altitudeHistory: 3 },
          preferences: OPEN_PREFS, likes: ['1', '2', dolpo],
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.cohort.candidates).toBe(0);
      expect(feed.cohort.neighbours).toBe(0);
      expect(feed.weights.collaborative).toBe(0);
    });

    it('gives a brand-new account no collaborative weight, however busy the crowd is', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS },
        { id: 'p1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2', '3'] },
        { id: 'p2', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['4', '5'] },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.weights.collaborative).toBe(0);
      expect(feed.coldStart).toBe(true);
    });
  });

  describe('safety matrix', () => {
    it('hard-blocks unsafe routes even when the affinity points straight at them', async () => {
      const { service } = buildWorld([
        {
          id: 'u1', dateOfBirth: dobForAge(30),
          profile: { ageGroup: 1, experienceLevel: 1, cardioFlag: 0, jointFlag: 0, altitudeHistory: 0 },
          preferences: OPEN_PREFS,
          likes: ['3', '4'], // both Hard and high — exactly what must not come back
        },
      ]);
      const feed = await service.getForYou('u1');

      expect(feed.recommended.length).toBeGreaterThan(0);
      expect(feed.filteredOut.length).toBeGreaterThan(0);
      for (const id of feed.order) {
        const trek = TREK_BY_ID.get(id)!;
        expect(trek.maxAltitude).toBeLessThanOrEqual(4000);
        expect(trek.difficulty).not.toBe('Hard');
        expect(trek.durationDays).toBeLessThanOrEqual(12);
      }
    });
  });

  describe('invariants', () => {
    /**
     * `[label, user, minFeedSize]`.
     *
     * The size floor is per-case rather than a blanket "> 0" because completed
     * treks are now excluded unconditionally: an account that has walked the
     * entire catalogue has nothing left to be recommended, and an empty feed is
     * the correct answer there. Every *other* invariant — no duplicates, finite
     * scores in range, weights summing to one — still has to hold for it.
     */
    const edgeCases: [string, StubUser, number][] = [
      ['no date of birth', { id: 'u1', dateOfBirth: null, profile: HEALTHY, preferences: OPEN_PREFS }, 1],
      ['unparseable date of birth', { id: 'u1', dateOfBirth: 'not-a-date', profile: {} as any, preferences: {} as any }, 1],
      ['impossible preferences', { id: 'u1', dateOfBirth: dobForAge(80), profile: { ...HEALTHY, ageGroup: 4 }, preferences: { maxDuration: 1, maxPrice: 1, difficulty: 'Hard' } }, 1],
      ['age below the bracket floor', { id: 'u1', dateOfBirth: dobForAge(15), profile: HEALTHY, preferences: OPEN_PREFS }, 1],
      ['ageGroup stored outside the bracket range', { id: 'u1', dateOfBirth: null, profile: { ...HEALTHY, ageGroup: 99 }, preferences: OPEN_PREFS }, 1],
      ['everything liked and completed', { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: TREK_METADATA.map(t => t.trekId), completedTrekIds: TREK_METADATA.map(t => t.trekId) }, 0],
      ['completed ids not in the catalogue', { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, completedTrekIds: ['nope', ''] }, 1],
    ];

    it.each(edgeCases)('returns a sane feed: %s', async (_label, user, minFeedSize) => {
      const { service } = buildWorld([user]);
      const feed = await service.getForYou('u1');

      expect(feed.order.length).toBeGreaterThanOrEqual(minFeedSize);
      expect(new Set(feed.order).size).toBe(feed.order.length);
      for (const row of feed.recommended) {
        expect(Number.isFinite(row.score)).toBe(true);
        expect(row.score).toBeGreaterThanOrEqual(0);
        expect(row.score).toBeLessThanOrEqual(1);
      }
      const total =
        feed.weights.attributeFit +
        feed.weights.popularity +
        feed.weights.affinity +
        feed.weights.collaborative;
      expect(total).toBeCloseTo(1, 10);
    });

    it('never returns the whole catalogue', async () => {
      const { service } = buildWorld([
        { id: 'u1', dateOfBirth: dobForAge(30), profile: HEALTHY, preferences: OPEN_PREFS, likes: ['1', '2', '3', '4'] },
      ]);
      const feed = await service.getForYou('u1');
      expect(feed.recommended.length).toBeLessThan(TREK_METADATA.length);
      expect(feed.totalConsidered).toBe(TREK_METADATA.length);
    });
  });
});
