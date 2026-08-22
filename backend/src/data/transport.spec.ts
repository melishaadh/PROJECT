import { TREK_ROUTES } from '@/data/trek-routes';
import { canonicalLocation, planTransfer, resolveHub } from '@/data/transport';

const modes = (from: string, to: string) =>
  (planTransfer(from, to)?.options ?? []).map(o => o.mode).sort();

const recommended = (from: string, to: string) =>
  planTransfer(from, to)!.options.find(o => o.recommended)!;

describe('planTransfer', () => {
  it('needs no leg when the traveller is already at the trailhead', () => {
    expect(planTransfer('Pokhara', 'Pokhara')).toBeNull();
    // Bhaktapur is inside the Kathmandu valley — arriving there is arriving.
    expect(planTransfer('Bhaktapur', 'Kathmandu')).toBeNull();
    expect(planTransfer('  POKHARA ', 'lekhnath')).toBeNull();
  });

  /**
   * The defect this module replaced: every transfer was emitted as a flight,
   * because the nearby-check it was gated on could never return true. Any place
   * without an airport must be reachable only by road.
   */
  it('never offers a flight where there is no airport at both ends', () => {
    expect(modes('Kathmandu', 'Besisahar')).toEqual(['road_travel']);
    expect(modes('Pokhara', 'Besisahar')).toEqual(['road_travel']);
    expect(modes('Kathmandu', 'Syabrubesi')).toEqual(['road_travel']);
  });

  it('offers both modes when the journey can genuinely be made either way', () => {
    expect(modes('Kathmandu', 'Pokhara')).toEqual(['flight', 'road_travel']);

    const options = planTransfer('Kathmandu', 'Pokhara')!.options;
    const flight = options.find(o => o.mode === 'flight')!;
    const drive = options.find(o => o.mode === 'road_travel')!;

    expect(drive.distanceKm).toBe(200);
    expect(drive.durationHours).toBeGreaterThan(flight.durationHours);
    // Exactly one option is the one the plan is costed against.
    expect(options.filter(o => o.recommended)).toHaveLength(1);
    expect(flight.recommended).toBe(true);
  });

  it('prefers the drive when it is the shorter half of a short pair', () => {
    expect(recommended('Kathmandu', 'Chitwan').mode).toBe('road_travel');
    expect(recommended('Kathmandu', 'Nepalgunj').mode).toBe('flight');
  });

  it('offers only the flight to a roadless trailhead', () => {
    expect(modes('Kathmandu', 'Lukla')).toEqual(['flight']);
    // The Manthali substitution is the kind of thing a traveller should not
    // discover at the airport.
    expect(recommended('Kathmandu', 'Lukla').caution).toMatch(/Manthali/);
  });

  it('routes a spoke-to-spoke journey through the network hub', () => {
    const flight = recommended('Pokhara', 'Lukla');
    expect(flight.mode).toBe('flight');
    expect(flight.detail).toMatch(/Connecting via Kathmandu/);
    // A connection costs a second round of airport time, not one.
    expect(flight.durationHours).toBeGreaterThan(recommended('Kathmandu', 'Lukla').durationHours);
  });

  it('says so plainly rather than inventing a leg from an unknown place', () => {
    const plan = planTransfer('Ghandruk', 'Pokhara')!;
    expect(plan.approximate).toBe(true);
    expect(plan.options.map(o => o.mode)).toEqual(['road_travel']);
    expect(plan.options[0].detail).toMatch(/arrange this leg locally/i);
  });

  it('reports canonical names so aliases plan and display as their hub', () => {
    expect(canonicalLocation('bhaktapur')).toBe('Kathmandu');
    expect(canonicalLocation('bharatpur')).toBe('Chitwan');
    // Unknown text is handed back untouched rather than guessed at.
    expect(canonicalLocation('  Ghandruk ')).toBe('Ghandruk');
  });

  it('never returns an empty option list', () => {
    for (const [a, b] of [['London', 'Pokhara'], ['Ghandruk', 'Lukla'], ['Jomsom', 'Lukla']]) {
      const plan = planTransfer(a, b);
      expect(plan!.options.length).toBeGreaterThan(0);
      expect(plan!.options.some(o => o.recommended)).toBe(true);
    }
  });

  /**
   * Every place a trek starts or ends is somewhere the planner has to be able
   * to reason about concretely — an unknown trailhead degrades every plan that
   * uses it to the "arrange locally" placeholder.
   */
  it('knows every trailhead in the catalogue', () => {
    const endpoints = new Set<string>();
    for (const route of TREK_ROUTES) {
      const stages = route.routeStages;
      if (!stages.length) continue;
      endpoints.add(stages[0].from);
      endpoints.add(stages[stages.length - 1].to);
    }

    for (const place of endpoints) {
      expect({ place, known: !!resolveHub(place) }).toEqual({ place, known: true });
    }
  });
});
