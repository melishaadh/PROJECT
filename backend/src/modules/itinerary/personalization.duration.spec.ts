import { PersonalizationService, PersonalizationInput } from './personalization.service';
import { TREK_ROUTES, TREK_ROUTE_BY_ID, TrekRoute } from '@/data/trek-routes';

/**
 * A trek's published duration — the number the trek card shows and the anchor
 * every duration rule is derived from. `stage.day` is the route data's own
 * declaration of which day a stage belongs to, so the highest one is the
 * trek length.
 */
const baseDurationOf = (route: TrekRoute) =>
  Math.max(...route.routeStages.map(s => s.day));

/** Mirrors `validateDuration`: a request above this is legitimately clamped. */
const ceilingFor = (base: number) => Math.min(Math.max(base * 2, base + 7), 60);

const BEGINNER: PersonalizationInput = {
  pace: 'normal',
  fitnessLevel: 'beginner',
  trekkingExperience: 'none',
  startLocation: 'Kathmandu',
};

describe('PersonalizationService — target duration', () => {
  const svc = new PersonalizationService();

  const run = (route: TrekRoute, overrides: Partial<PersonalizationInput> = {}) =>
    svc.generate(route.name, route.difficulty, route.routeStages, {
      ...BEGINNER,
      ...overrides,
    });

  it('extends a 10-day trek to the requested 15 days', () => {
    const route = TREK_ROUTE_BY_ID.get('2')!; // Poon Hill Panorama ABC
    expect(baseDurationOf(route)).toBe(10);

    const result = run(route, { targetDays: 15 });

    expect(result.rejectionReason).toBeUndefined();
    expect(result.days).toHaveLength(15);
    expect(result.totalDays).toBe(15);
  });

  it('scales every trek to its target, or to the clamp ceiling', () => {
    for (const route of TREK_ROUTES) {
      const base = baseDurationOf(route);

      for (const target of [base, base + 3, base + 5, base + 7, base * 2]) {
        const result = run(route, { targetDays: target });

        expect(result.rejectionReason).toBeUndefined();

        const expected = Math.min(target, ceilingFor(base));
        expect({ trek: route.trekId, target, days: result.days.length })
          .toEqual({ trek: route.trekId, target, days: expected });

        // totalDays must always agree with the rendered day cards
        expect(result.totalDays).toBe(result.days.length);
        // day numbers must be a contiguous 1..N sequence
        expect(result.days.map(d => d.day)).toEqual(result.days.map((_, i) => i + 1));
      }
    }
  });

  /**
   * Regression: the base duration used to be counted from stages with
   * `distance > 0 && estimatedHours > 0`, which dropped every flight, drive and
   * rest stage. That under-counted 25 of the 30 treks and — because the ceiling
   * is a multiple of the base — silently capped extension requests well below
   * what was asked for. A 3-day trek could never exceed 6 days.
   */
  it('honours a large extension even on the shortest treks', () => {
    const shortest = TREK_ROUTES
      .filter(r => baseDurationOf(r) <= 4)
      .map(r => r.trekId);
    expect(shortest.length).toBeGreaterThan(0);

    for (const id of shortest) {
      const route = TREK_ROUTE_BY_ID.get(id)!;
      const base = baseDurationOf(route);
      const result = run(route, { targetDays: base + 7 });

      expect(result.days).toHaveLength(base + 7);
    }
  });

  it('never plans fewer days than the trek advertises', () => {
    for (const route of TREK_ROUTES) {
      const base = baseDurationOf(route);

      // Automatic mode — no target at all.
      expect(run(route).days.length).toBeGreaterThanOrEqual(base);

      // A capable trekker still may not be handed a shorter plan than the card
      // unless they explicitly ask for one.
      const strong = run(route, {
        pace: 'fast', fitnessLevel: 'expert', trekkingExperience: 'extensive',
      });
      expect(strong.days.length).toBeGreaterThanOrEqual(base);
    }
  });

  it('leaves the plan connected when days are split or padded', () => {
    const route = TREK_ROUTE_BY_ID.get('2')!;
    const result = run(route, { targetDays: 15 });

    for (let i = 0; i < result.days.length - 1; i++) {
      const endsAt = result.days[i].overnightLocation;
      const startsAt = result.days[i + 1].activities[0]?.from;
      expect(startsAt?.toLowerCase()).toBe(endsAt.toLowerCase());
    }
  });

  it('still compresses when the target is below what scheduling produces', () => {
    const route = TREK_ROUTE_BY_ID.get('2')!;
    const result = run(route, { targetDays: 10 });

    expect(result.rejectionReason).toBeUndefined();
    expect(result.days).toHaveLength(10);
  });

  describe('experience gates compression, not extension', () => {
    const route = TREK_ROUTE_BY_ID.get('2')!; // base 10

    it.each(['none', 'basic'] as const)(
      'rejects a shortened trek for a %s trekker',
      exp => {
        const result = run(route, { trekkingExperience: exp, targetDays: 8 });

        expect(result.rejectionReason).toBeDefined();
        expect(result.minimumSafeDays).toBe(10);
        expect(result.days).toHaveLength(0);
      },
    );

    it('lets an extensively experienced trekker shorten the trek', () => {
      const result = run(route, { trekkingExperience: 'extensive', targetDays: 8 });

      expect(result.rejectionReason).toBeUndefined();
      expect(result.days).toHaveLength(8);
    });

    it('lets a beginner take extra days', () => {
      const result = run(route, { trekkingExperience: 'none', targetDays: 16 });

      expect(result.rejectionReason).toBeUndefined();
      expect(result.days).toHaveLength(16);
    });
  });

  it('reports a day count that matches the days it returns', () => {
    for (const route of TREK_ROUTES) {
      for (const targetDays of [undefined, baseDurationOf(route) + 4]) {
        const result = run(route, { targetDays });
        expect(result.totalDays).toBe(result.days.length);
        expect(result.days.map(d => d.day)).toEqual(result.days.map((_, i) => i + 1));
      }
    }
  });

  /**
   * Capability now comes from the treks actually on the user's profile. This
   * replaced a standalone `previousTreks` count that the engine never read at
   * all — the field was inert end to end.
   */
  describe('completed treks feed the capability profile', () => {
    const route = TREK_ROUTE_BY_ID.get('8')!; // Everest Base Camp Classic

    const effortFor = (completedTrekIds?: string[]) =>
      run(route, {
        fitnessLevel: 'intermediate',
        trekkingExperience: 'moderate',
        completedTrekIds,
      });

    it('leaves the plan unchanged when there is no history', () => {
      const omitted = effortFor(undefined);
      const empty = effortFor([]);

      expect(empty.days).toHaveLength(omitted.days.length);
      expect(empty.totalEffort).toBe(omitted.totalEffort);
    });

    it('treats a logged history as extra capability', () => {
      const novice = effortFor([]);
      const veteran = effortFor(['7', '8', '9', '10', '17', '21', '29']);

      // Higher capability divides the effort modifier, so the same route costs
      // a seasoned trekker less. Observable proof the history is read.
      expect(veteran.totalEffort).toBeLessThan(novice.totalEffort);
    });

    /**
     * The whole reason this is an array of ids and not a count: what was walked
     * has to matter. Three Everest passes and three easy Annapurna days are the
     * same *number* of treks and very different evidence.
     */
    it('weighs hard, high routes above easy ones', () => {
      const easy = effortFor(['5', '6', '23']);        // 3 × Easy, ~3,200-3,500m
      const hard = effortFor(['9', '10', '29']);       // 3 × Hard, 5,388-6,135m

      expect(hard.totalEffort).toBeLessThan(easy.totalEffort);
    });

    it('ignores unknown ids gracefully and de-duplicates repeats', () => {
      const dupes = effortFor(['8', '8', '8', '8']);
      const single = effortFor(['8']);
      expect(dupes.totalEffort).toBe(single.totalEffort);

      // An id no longer in the catalogue still counts as a walked route, but
      // must not throw or wipe out the rest of the history.
      expect(() => effortFor(['8', 'not-a-real-trek'])).not.toThrow();
      expect(effortFor(['8', 'not-a-real-trek']).totalEffort)
        .toBeLessThanOrEqual(single.totalEffort);
    });

    it('saturates rather than scaling without limit', () => {
      const everything = TREK_ROUTES.map(r => r.trekId);
      const doubled = [...everything, ...everything];
      expect(effortFor(doubled).totalEffort).toBe(effortFor(everything).totalEffort);
    });
  });

  it('returns every field the client contract declares', () => {
    const route = TREK_ROUTE_BY_ID.get('1')!;
    const result = run(route, { targetDays: 9, finalDestination: 'Pokhara' });

    // Mirrors `PersonalizedItinerary` in lib/itineraryApi.ts. A field added on
    // one side and forgotten on the other is exactly the desync this catches.
    for (const key of [
      'trekName', 'totalDays', 'totalDistance', 'totalEffort', 'maxAltitude',
      'suitability', 'cautions', 'origin', 'finalDestination', 'days',
    ] as const) {
      expect(result[key]).toBeDefined();
    }

    expect(result.origin).toBeTruthy();
    expect(result.finalDestination).toBeTruthy();
    expect(result.totalEffort).toBeGreaterThan(0);

    for (const day of result.days) {
      for (const key of [
        'day', 'activities', 'totalHours', 'totalDistance',
        'totalElevationGain', 'maxAltitude', 'overnightLocation', 'notes',
      ] as const) {
        expect(day[key]).toBeDefined();
      }
      for (const a of day.activities) {
        for (const key of [
          'type', 'from', 'to', 'distance', 'elevationGain',
          'durationHours', 'effortScore', 'description',
        ] as const) {
          expect(a[key]).toBeDefined();
        }
      }
    }
  });

  /**
   * The ascent-rate rule. Unlike every other altitude rule in the engine this
   * one is not gated on the user's altitude tolerance — above 3,000m how much
   * higher you sleep is physiology, not fitness.
   */
  describe('rest-day and acclimatization intelligence', () => {
    const ebc = TREK_ROUTE_BY_ID.get('8')!;
    const EBC_PEAK = 5364;

    const plan = (overrides: Partial<PersonalizationInput>, peak = EBC_PEAK) =>
      svc.generate(ebc.name, ebc.difficulty, ebc.routeStages,
        { ...BEGINNER, ...overrides }, peak);

    const acclimatizationDays = (r: ReturnType<typeof plan>) =>
      r.days.filter(d => d.activities.some(a => a.type === 'acclimatization'));

    it('injects standalone acclimatization days on a high route', () => {
      const result = plan({ fitnessLevel: 'expert', trekkingExperience: 'extensive', pace: 'fast' });
      const acc = acclimatizationDays(result);

      expect(acc.length).toBeGreaterThan(0);
      // A whole day, not two hours folded into a trekking day — absorbing an
      // ascent-rate break would leave the user sleeping just as high.
      for (const day of acc) {
        expect(day.activities.every(a => a.type === 'acclimatization' || a.type === 'rest')).toBe(true);
        expect(day.totalElevationGain).toBe(0);
      }
    });

    it('gives a weaker profile more acclimatization than a strong one', () => {
      const strong = acclimatizationDays(
        plan({ fitnessLevel: 'expert', trekkingExperience: 'extensive', pace: 'fast' }),
      ).length;
      const weak = acclimatizationDays(
        plan({ fitnessLevel: 'beginner', trekkingExperience: 'none', pace: 'slow' }),
      ).length;

      expect(weak).toBeGreaterThanOrEqual(strong);
    });

    /**
     * Regression: altitude used to be tracked as cumulative gain from zero, so
     * a trek flying into Lukla at 2,860m did not read as "above 3,000m" until
     * it was physically near 5,900m and the rule never fired.
     */
    it('measures altitude in real metres, not cumulative gain', () => {
      const withPeak = acclimatizationDays(plan({})).length;
      // Without the catalogue peak the engine falls back to gain-from-zero,
      // which reaches the 3,000m floor far later in the route.
      const withoutPeak = acclimatizationDays(plan({}, 0)).length;

      expect(withPeak).toBeGreaterThan(withoutPeak);
    });

    it('leaves a low-altitude trek alone', () => {
      const mardi = TREK_ROUTE_BY_ID.get('23')!; // Mardi Forest Explorer, 3,500m
      const result = svc.generate(mardi.name, mardi.difficulty, mardi.routeStages,
        { ...BEGINNER }, 3500);
      // Nothing on this route climbs 600m in a day while above 3,000m.
      expect(result.days.length).toBeGreaterThan(0);
      expect(result.rejectionReason).toBeUndefined();
    });
  });

  it('does not repeat the same caution twice', () => {
    for (const route of TREK_ROUTES) {
      const result = run(route, { startLocation: 'Biratnagar', targetDays: 30 });
      expect(new Set(result.cautions).size).toBe(result.cautions.length);
    }
  });
});
