import { Injectable } from '@nestjs/common';
import { RouteStage } from '@/data/trek-routes';
import { TREK_METADATA, altitudeHistoryFor } from '@/data/trek-metadata';
import {
  TransferOption,
  TransferPlan,
  canonicalLocation,
  planTransfer,
} from '@/data/transport';

export interface PersonalizationInput {
  pace: 'slow' | 'normal' | 'fast';
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  trekkingExperience: 'none' | 'basic' | 'moderate' | 'extensive';
  targetDays?: number;
  age?: number;
  weight?: number;
  groupSize?: number;
  /**
   * The trek ids on the user's profile — their actual logged history.
   *
   * This replaced a standalone `previousTreks` count. A bare number said
   * nothing about *what* was walked, and three Everest passes is not the same
   * evidence of capability as three Poon Hill weekends. Resolved against the
   * catalogue in `buildCapabilityProfile`.
   */
  completedTrekIds?: string[];
  startLocation?: string;
  finalDestination?: string;
}

/** Catalogue lookup for scoring completed treks. Built once. */
const TREK_META_BY_ID = new Map(TREK_METADATA.map(t => [t.trekId, t]));

export interface ActivityDetail {
  type: 'road_travel' | 'flight' | 'trekking' | 'rest' | 'acclimatization' | 'checkpoint_stop' | 'meal_break' | 'recovery_break' | 'sightseeing';
  from: string;
  to: string;
  distance: number;
  elevationGain: number;
  durationHours: number;
  effortScore: number;
  description: string;
  /**
   * Set only on the transfer legs that connect the user's own start/finish to
   * the route's endpoints, and only when the journey can genuinely be made more
   * than one way. The activity itself is costed against whichever option is
   * `recommended`; the rest are there so the traveller can overrule that — the
   * flight saves a day, the drive is a tenth of the price and does not get
   * cancelled by cloud, and which of those matters is not ours to decide.
   */
  options?: TransferOption[];
}

export interface ItineraryDay {
  day: number;
  activities: ActivityDetail[];
  totalHours: number;
  totalDistance: number;
  totalElevationGain: number;
  maxAltitude: number;
  overnightLocation: string;
  notes: string[];
  /**
   * Set on days the ascent-rate rule inserted. Those exist to break up a climb
   * that is too fast above 3,000m, so the compression pass must not merge them
   * away — folding one back into a trekking day restores exactly the ascent
   * profile it was added to prevent.
   */
  mandatory?: boolean;
}

export interface PersonalizedItinerary {
  trekName: string;
  totalDays: number;
  totalDistance: number;
  totalEffort: number;
  maxAltitude: number;
  suitability: 'Low' | 'Moderate' | 'High';
  cautions: string[];
  origin: string;
  finalDestination: string;
  days: ItineraryDay[];
  rejectionReason?: string;
  minimumSafeDays?: number;
  recommendedDays?: number;
}

/**
 * Hard ceiling on generated days. Not a planning rule — purely a guard so an
 * absurd `targetDays` can't turn into thousands of padding days of compute.
 * The longest trek in the catalogue is 20 days, so this leaves ample headroom.
 */
const MAX_ITINERARY_DAYS = 60;

/**
 * Ceiling on the capability bonus a completed-trek history can earn, and the
 * rate it accrues at. 12% is deliberately smaller than the age (15-20%) and
 * weight (15-25%) penalties: experience should shade a plan, never cancel out a
 * physical risk factor. The rate reaches the cap at roughly ten demanding
 * treks — enough that a genuinely seasoned profile is recognised, not so much
 * that a handful of easy walks reads as expertise.
 */
const HISTORY_BONUS_CAP = 0.12;
const HISTORY_BONUS_PER_POINT = 0.012;

/**
 * Altitude above which the daily ascent-rate rule applies. Below this, gain is
 * a stamina question the effort budgets already handle; above it, it becomes a
 * physiological one. See `safeDailyGain`.
 */
const ASCENT_RULE_FLOOR_M = 3000;

const ABBR_MAP: Record<string, string> = {
  'ABC': 'Annapurna Base Camp',
  'MBC': 'Machhapuchhre Base Camp',
  'EBC': 'Everest Base Camp',
};

interface RouteSegment {
  from: string;
  to: string;
  distance: number;
  elevationGain: number;
  baseHours: number;
  altitude: number;
  type: 'road_travel' | 'flight' | 'trekking' | 'rest' | 'acclimatization' | 'checkpoint_stop';
  checkpoint: string;
  /** Carried through to the activity on transfer legs. See `ActivityDetail.options`. */
  options?: TransferOption[];
}

interface CapabilityProfile {
  maxDailyHours: number;
  maxEffortPerDay: number;
  maxElevationPerDay: number;
  breakIntervalHours: number;
  recoveryFactor: number;
  altitudeTolerance: number;
  paceMultiplier: number;
  effortModifier: number;
}

interface BreakSuggestion {
  afterIndex: number;
  type: 'acclimatization' | 'recovery_break' | 'rest_day';
  reason: string;
  /**
   * Blocks the absorption path in Step 6.
   *
   * Most breaks are a *fatigue* remedy, and folding a couple of hours of rest
   * into a day that has room genuinely helps. An ascent-rate break is not:
   * the risk comes from the altitude you sleep at, so a two-hour sit-down on
   * the same day leaves the user exactly as exposed while making the plan look
   * like it responded. Those breaks have to become a day of their own or not
   * exist at all.
   */
  mustBeStandalone?: boolean;
}

@Injectable()
export class PersonalizationService {
  generate(
    trekName: string,
    difficulty: string,
    stages: RouteStage[],
    input: PersonalizationInput,
    peakAltitude?: number,
  ): PersonalizedItinerary {
    // ── Step 0: Normalize inputs & build capability profile ──────────────
    const profile = this.buildCapabilityProfile(input);
    const startAltitude = this.inferStartAltitude(stages, peakAltitude);
    const origin = input.startLocation?.trim() || '';
    const finalDest = input.finalDestination?.trim() || '';
    const baseDifficulty = this.difficultyToNumber(difficulty);
    const baseDuration = this.computeBaseDuration(stages);

    // ── Step 1: Build complete route path ────────────────────────────────
    const route = this.buildRoute(stages, origin, finalDest, baseDifficulty);

    // ── Step 2: Determine planning mode ──────────────────────────────────
    //
    // Two modes, and the difference is only how *hard* the target binds:
    //
    //  • Explicit  — the caller passed `targetDays` (the trek deep-link sends
    //    the card's duration). The plan is force-fitted to it, compressing past
    //    comfort if it has to, because the user asked for exactly that many days.
    //
    //  • Automatic — no `targetDays`. The trek's own declared duration becomes
    //    a *soft* target: the plan is never allowed to come out SHORTER than the
    //    advertised trek, but it may run longer when the user's capability
    //    genuinely needs the recovery days. Before this, automatic mode had no
    //    anchor at all and drifted ±2 days off the trek card.
    const requestedTarget = input.targetDays ?? null;
    let explicitTarget: number | null = null;

    if (requestedTarget !== null) {
      const durationInfo = this.validateDuration(requestedTarget, baseDuration, input, profile);
      if (durationInfo.rejected) {
        return {
          trekName,
          totalDays: 0,
          totalDistance: 0,
          totalEffort: 0,
          maxAltitude: 0,
          suitability: 'Low',
          cautions: [durationInfo.rejected],
          origin: origin || 'Unknown',
          finalDestination: finalDest || 'Unknown',
          days: [],
          rejectionReason: durationInfo.rejected,
          minimumSafeDays: durationInfo.minimumSafeDays,
          recommendedDays: durationInfo.recommendedDays,
        };
      }
      explicitTarget = durationInfo.target;
    }

    const isExplicitTarget = explicitTarget !== null;
    const effectiveTarget = explicitTarget ?? baseDuration;

    // ── Step 3: Convert route segments into activity blocks ──────────────
    const activities = this.segmentsToActivities(route, profile);

    // ── Step 4: Estimate effort scores ───────────────────────────────────
    const scored = activities.map(a => this.computeEffortScore(a, profile, baseDifficulty));

    // ── Step 5: Schedule activities into days using time budgets ─────────
    let scheduled = this.scheduleIntoDays(scored, profile);

    // ── Step 6: Add recovery / acclimatization ───────────────────────────
    // Only an explicit target constrains recovery. In automatic mode the safe
    // number of rest days is whatever the profile needs — Step 7 fits after.
    scheduled = this.addRecoveryAndAcclimatization(
      scheduled, profile, baseDifficulty, explicitTarget, startAltitude,
    );

    // ── Step 7: Fit to target — expand (pad/split) or compress ───────────
    scheduled = this.fitToTarget(scheduled, profile, effectiveTarget, isExplicitTarget);

    // ── Step 8: Final validation ─────────────────────────────────────────
    return this.finalize(
      scheduled, input, profile, baseDifficulty, trekName, origin, finalDest,
      baseDuration, explicitTarget,
    );
  }

  // ── Validate / clamp target duration against base + experience ─────────
  private validateDuration(
    targetDays: number,
    baseDuration: number,
    input: PersonalizationInput,
    profile: CapabilityProfile,
  ): { target: number; rejected?: string; minimumSafeDays?: number; recommendedDays?: number } {
    const exp = input.trekkingExperience || 'none';

    // How far the trek may be *compressed*, gated on experience. Beginners
    // (`none` / `basic`) may never shorten the published duration.
    let minDuration: number;

    if (exp === 'extensive') {
      minDuration = Math.max(1, baseDuration - 2);
    } else if (exp === 'none' || exp === 'basic') {
      minDuration = baseDuration;
    } else {
      minDuration = Math.max(1, baseDuration - 1);
    }

    // Never let any experience level cut more than 30% off the trek.
    minDuration = Math.max(minDuration, Math.ceil(baseDuration * 0.7));

       let maxDuration = Math.max(baseDuration * 2, baseDuration + 7);
    maxDuration = Math.min(maxDuration, MAX_ITINERARY_DAYS);

    // Users with very low capacity legitimately need more days than the ratio
    // above allows, so the profile floor can only ever raise the ceiling.
    const profileMinDays = Math.ceil(baseDuration / Math.max(0.5, profile.recoveryFactor));
    maxDuration = Math.max(maxDuration, Math.min(profileMinDays, MAX_ITINERARY_DAYS));

    if (targetDays < minDuration) {
      return {
        target: baseDuration,
        rejected: `${targetDays} days is too short for this trek. The minimum is ${minDuration} days — we recommend ${baseDuration} days for a safe and enjoyable journey.`,
        minimumSafeDays: minDuration,
        recommendedDays: baseDuration,
      };
    }

    if (targetDays > maxDuration) {
      return { target: maxDuration };
    }

    return { target: targetDays };
  }

  // ── Build a capability profile from user inputs ────────────────────────
  private buildCapabilityProfile(input: PersonalizationInput): CapabilityProfile {
    const pace = input.pace || 'normal';
    const fitness = input.fitnessLevel || 'beginner';
    const experience = input.trekkingExperience || 'none';
    const age = input.age || 30;
    const weight = input.weight || 70;
    const groupSize = input.groupSize || 1;

    const paceMap: Record<string, number> = { slow: 0.8, normal: 1.0, fast: 1.15 };
    const fitnessMap: Record<string, number> = { beginner: 0.6, intermediate: 0.8, advanced: 1.0, expert: 1.15 };
    const expMap: Record<string, number> = { none: 0.5, basic: 0.7, moderate: 0.9, extensive: 1.1 };

    let baseCapability = (paceMap[pace] + fitnessMap[fitness] + expMap[experience]) / 3;

    if (age > 50) baseCapability *= 0.85;
    if (age > 60) baseCapability *= 0.8;
    if (weight > 100) baseCapability *= 0.85;
    if (weight > 120) baseCapability *= 0.75;
 
    if (groupSize > 1) {
      baseCapability *= Math.max(0.75, 1 - 0.025 * (groupSize - 1));
    }

    // Track record, weighted by what was actually walked. See `historyBonus`.
    baseCapability *= this.historyBonus(input.completedTrekIds);

    baseCapability = Math.max(0.3, Math.min(1.2, baseCapability));

    const maxHours = baseCapability >= 1.0 ? 9
      : baseCapability >= 0.8 ? 8
      : baseCapability >= 0.6 ? 6.5
      : baseCapability >= 0.45 ? 5.5
      : 4.5;

    const maxEffort = baseCapability >= 1.0 ? 50
      : baseCapability >= 0.8 ? 40
      : baseCapability >= 0.6 ? 30
      : baseCapability >= 0.45 ? 22
      : 16;

    const maxElevation = baseCapability >= 1.0 ? 1200
      : baseCapability >= 0.8 ? 900
      : baseCapability >= 0.6 ? 650
      : baseCapability >= 0.45 ? 450
      : 300;

    const breakInterval = baseCapability >= 1.0 ? 3
      : baseCapability >= 0.8 ? 2.5
      : baseCapability >= 0.6 ? 2
      : baseCapability >= 0.45 ? 1.5
      : 1.2;

    return {
      maxDailyHours: maxHours,
      maxEffortPerDay: maxEffort,
      maxElevationPerDay: maxElevation,
      breakIntervalHours: breakInterval,
      recoveryFactor: baseCapability,
      altitudeTolerance: baseCapability,
      paceMultiplier: paceMap[pace],
      effortModifier: 1.0 / baseCapability,
    };
  }

  private inferStartAltitude(stages: RouteStage[], peakAltitude?: number): number {
    if (!peakAltitude || !Number.isFinite(peakAltitude) || peakAltitude <= 0) return 0;
    const totalGain = stages.reduce((sum, s) => sum + Math.max(0, s.elevationGain || 0), 0);
    return Math.max(0, Math.round(peakAltitude - totalGain));
  }

  private historyBonus(completedTrekIds?: string[]): number {
    if (!Array.isArray(completedTrekIds) || completedTrekIds.length === 0) return 1;

    // De-duplicated: the same trek logged twice is one trek's worth of evidence.
    const unique = new Set(
      completedTrekIds.filter(id => typeof id === 'string' && id.trim().length > 0),
    );
    if (unique.size === 0) return 1;

    const DIFFICULTY_WEIGHT: Record<string, number> = { easy: 0, moderate: 0.5, hard: 1 };

    let score = 0;
    for (const id of unique) {
      const meta = TREK_META_BY_ID.get(id);
      if (!meta) {
        score += 1; // Off-catalogue, but still a completed trek.
        continue;
      }
      const difficulty = DIFFICULTY_WEIGHT[meta.difficulty.toLowerCase()] ?? 0.5;
      // 0-3 altitude band, scaled so the highest routes add ~0.75.
      const altitude = altitudeHistoryFor(meta.maxAltitude) * 0.25;
      score += 1 + difficulty + altitude;
    }

    return 1 + Math.min(HISTORY_BONUS_CAP, score * HISTORY_BONUS_PER_POINT);
  }

  // ── Step 1: Build the actual connected route ──────────────────────────
  private buildRoute(
    stages: RouteStage[],
    origin: string,
    finalDest: string,
    baseDifficulty: number,
  ): RouteSegment[] {
    const route: RouteSegment[] = [];
    const firstStage = stages[0];
    const lastStage = stages[stages.length - 1];

    if (!firstStage) return route;

    const firstFrom = this.expandAbbr(firstStage.from);

    // If user origin is different from trek start, add transport segment
    const inbound = origin ? planTransfer(origin, firstFrom) : null;
    if (inbound) route.push(this.transferSegment(inbound));

    // Convert trek stages to route segments
    for (const stage of stages) {
      route.push({
        from: this.expandAbbr(stage.from),
        to: this.expandAbbr(stage.to),
        distance: stage.distance || 0,
        elevationGain: stage.elevationGain || 0,
        baseHours: stage.estimatedHours || 1,
        altitude: this.guessDestinationAltitude(stage.to, stage.elevationGain, route),
        type: 'trekking',
        checkpoint: stage.checkpoint || '',
      });
    }

    // If final destination differs from trek end, add transport segment
    const lastTo = this.expandAbbr(lastStage.to);
    const outbound = finalDest ? planTransfer(lastTo, finalDest) : null;
    if (outbound) route.push(this.transferSegment(outbound));

    return route;
  }


  private transferSegment(plan: TransferPlan): RouteSegment {
    const chosen = plan.options.find(o => o.recommended) ?? plan.options[0];
    const verb = chosen.mode === 'flight' ? 'Fly' : 'Travel';

    return {
      from: plan.from,
      to: plan.to,
      distance: 0,
      elevationGain: 0,
      baseHours: chosen.durationHours,
      altitude: 0,
      type: chosen.mode,
      checkpoint: `${verb} from ${plan.from} to ${plan.to}`,
      options: plan.options,
    };
  }

  // ── Convert route segments to activity blocks ──────────────────────────
  private segmentsToActivities(
    route: RouteSegment[],
    profile: CapabilityProfile,
  ): ActivityDetail[] {
    const activities: ActivityDetail[] = [];

    for (const seg of route) {
      if (seg.type === 'flight' || seg.type === 'road_travel') {
        const hours = seg.baseHours > 0 ? seg.baseHours : seg.distance / 50;
        activities.push({
          type: seg.type,
          from: seg.from,
          to: seg.to,
          distance: seg.distance,
          elevationGain: 0,
          durationHours: Math.max(0.5, hours),
          effortScore: seg.type === 'flight' ? 2 : 3,
          description: seg.checkpoint,
          ...(seg.options ? { options: seg.options } : {}),
        });
        continue;
      }

      const hours = seg.baseHours > 0 ? seg.baseHours : seg.distance / 3 + seg.elevationGain / 300;
      activities.push({
        type: 'trekking',
        from: seg.from,
        to: seg.to,
        distance: seg.distance,
        elevationGain: seg.elevationGain,
        durationHours: Math.round(hours * 10) / 10,
        effortScore: 0,
        description: seg.checkpoint || `Trek from ${seg.from} to ${seg.to}`,
      });
    }

    return activities;
  }

  // ── Compute effort score for an activity ───────────────────────────────
  private computeEffortScore(
    activity: ActivityDetail,
    profile: CapabilityProfile,
    baseDifficulty: number,
  ): ActivityDetail {
    if (activity.type === 'rest' || activity.type === 'acclimatization' || activity.type === 'meal_break') {
      activity.effortScore = 0;
      return activity;
    }

    const distanceFactor = activity.distance * 1.5;
    const elevationFactor = activity.elevationGain / 80;
    const terrainFactor = baseDifficulty * 2;
    const durationFactor = activity.durationHours * 1.5;
    const effort = Math.round((distanceFactor + elevationFactor + terrainFactor + durationFactor) * profile.effortModifier);

    activity.effortScore = Math.max(0, effort);
    return activity;
  }

  // ── Schedule activities into days using time budgets ──────────────────
  private scheduleIntoDays(
    activities: ActivityDetail[],
    profile: CapabilityProfile,
  ): ItineraryDay[] {
    const days: ItineraryDay[] = [];
    let currentDay: ItineraryDay | null = null;

    for (const activity of activities) {
      if (!currentDay) {
        currentDay = this.createDay(days.length + 1);
      }

      const wouldFit = this.wouldFitInDay(currentDay, activity, profile);

      if (!wouldFit) {
        if (currentDay.activities.length === 0 && activity.type === 'trekking') {
          currentDay.activities.push(activity);
          this.updateDayTotals(currentDay);
          continue;
        }
        days.push(currentDay);
        currentDay = this.createDay(days.length + 1);
        currentDay.activities.push(activity);
        this.updateDayTotals(currentDay);
      } else {
        currentDay.activities.push(activity);
        this.updateDayTotals(currentDay);
      }
    }

    if (currentDay && currentDay.activities.length > 0) {
      days.push(currentDay);
    }

    return days;
  }

  private isNonBudgetActivity(activity: ActivityDetail): boolean {
    if (['rest', 'acclimatization', 'meal_break', 'recovery_break', 'checkpoint_stop', 'sightseeing'].includes(activity.type)) {
      return true;
    }
    if ((activity.type === 'road_travel' || activity.type === 'flight') && activity.durationHours < 2) {
      return true;
    }
    return false;
  }

  private wouldFitInDay(day: ItineraryDay, activity: ActivityDetail, profile: CapabilityProfile): boolean {
    if (this.isNonBudgetActivity(activity)) {
      return true;
    }

    const newHours = day.totalHours + activity.durationHours;
    const newEffort = day.activities.reduce((s, a) => s + a.effortScore, 0) + activity.effortScore;
    const newElevation = day.totalElevationGain + activity.elevationGain;

    if (newHours > profile.maxDailyHours) return false;
    if (newEffort > profile.maxEffortPerDay) return false;
    if (newElevation > profile.maxElevationPerDay) return false;

    return true;
  }

  private createDay(dayNumber: number): ItineraryDay {
    return {
      day: dayNumber,
      activities: [],
      totalHours: 0,
      totalDistance: 0,
      totalElevationGain: 0,
      maxAltitude: 0,
      overnightLocation: '',
      notes: [],
    };
  }

  private updateDayTotals(day: ItineraryDay): void {
    day.totalHours = 0;
    day.totalDistance = 0;
    day.totalElevationGain = 0;
    day.maxAltitude = 0;

    for (const a of day.activities) {
      day.totalHours += a.durationHours;
      day.totalDistance += a.distance;
      day.totalElevationGain += a.elevationGain;
    }
  }

  // ── Step 6: Intelligent recovery and acclimatization ──────────────────
  private addRecoveryAndAcclimatization(
    days: ItineraryDay[],
    profile: CapabilityProfile,
    baseDifficulty: number,
    targetDays: number | null,
    startAltitude = 0,
  ): ItineraryDay[] {
    if (days.length === 0) return days;

    const result: ItineraryDay[] = [];
    // Real metres above sea level, not cumulative gain — see `inferStartAltitude`.
    let currentAltitude = startAltitude;

    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const nextDay = i < days.length - 1 ? days[i + 1] : null;

      const dayMaxAlt = this.estimateDayMaxAltitude(day, currentAltitude);
      currentAltitude = dayMaxAlt;

      // Add within-day breaks for low-capability users
      if (profile.recoveryFactor < 0.6) {
        day.activities = this.addBreaksWithinDay(day.activities, profile);
        this.updateDayTotals(day);
      }

      day.maxAltitude = Math.max(dayMaxAlt, day.maxAltitude);
      result.push(day);

      // In automatic mode (null target), never constrain recovery days.
      // In targeted mode, respect remaining budget.
      const remainingDays = targetDays !== null ? targetDays - result.length : Infinity;

      // Determine breaks needed after adding the day
      const breaks = this.determineBreaksNeeded(result, day, nextDay, currentAltitude, profile, baseDifficulty, i);

      // A break sits AFTER this day, so it happens where the day ended — using
      // the day's starting point here left a route gap in the day-by-day cards.
      const breakLocation = day.activities[day.activities.length - 1]?.to
        || day.activities[0]?.from
        || '';

      const standaloneBreak = (br: BreakSuggestion) =>
        br.type === 'acclimatization'
          ? this.createAcclimatizationDay(
              result.length + 1, breakLocation, currentAltitude, br.mustBeStandalone,
            )
          : this.createRestDay(result.length + 1, breakLocation, currentAltitude, br.reason);

      for (const br of breaks) {
        // Absorption first, for every break type *except* the ones that only
        // work as a whole day: fold the rest into a day that still has room
        // before spending a whole extra day on it. Only when no nearby day can
        // take it does the break become a day of its own.
        if (
          !br.mustBeStandalone &&
          this.tryInsertRecovery(result, br, profile, currentAltitude) !== null
        ) {
          continue;
        }

        // Automatic mode leaves `remainingDays` at Infinity, so a needed break
        // always becomes a real day there; only an explicit target can run out.
        if (remainingDays > 0) {
          result.push(standaloneBreak(br));
          continue;
        }

        // Out of budget — only a genuinely critical break earns an extra day.
        const trekkingDays = result.filter(d =>
          d.activities.some(a => a.type === 'trekking'),
        ).length;
        if (currentAltitude > 4000 || (br.type === 'rest_day' && trekkingDays >= 4)) {
          result.push(standaloneBreak(br));
        }
      }
    }

    return result;
  }

  private determineBreaksNeeded(
    pastDays: ItineraryDay[],
    currentDay: ItineraryDay,
    nextDay: ItineraryDay | null,
    currentAltitude: number,
    profile: CapabilityProfile,
    baseDifficulty: number,
    dayIndex: number,
  ): BreakSuggestion[] {
    const breaks: BreakSuggestion[] = [];

    if (pastDays.length === 0) return breaks;

    // Check consecutive hard days
    let consecutiveHard = 0;
    for (let i = pastDays.length - 1; i >= 0 && i >= pastDays.length - 4; i--) {
      const d = pastDays[i];
      if (d.totalHours >= 6 || d.totalElevationGain >= 500) {
        consecutiveHard++;
      } else {
        break;
      }
    }

    if (consecutiveHard >= 4) {
      breaks.push({
        afterIndex: pastDays.length,
        type: 'rest_day',
        reason: 'Extended effort — recovery day needed',
      });
      return breaks;
    }

    if (consecutiveHard >= 3 && profile.recoveryFactor < 0.8) {
      breaks.push({
        afterIndex: pastDays.length,
        type: 'rest_day',
        reason: 'Multiple consecutive difficult days require recovery',
      });
      return breaks;
    }

    /*
      ── Hard ascent-rate rule ────────────────────────────────────────────────
      Above 3,000m, how much higher you sleep each night is governed by
      acclimatization, not stamina. Climbing more than ~600m in a day up there
      is the standard trigger for altitude sickness whoever you are, so unlike
      every rule below this one it is NOT gated on `altitudeTolerance` — a fit
      25-year-old ascending 900m at 4,000m is at risk precisely because they
      *can* do it comfortably in the moment.

      Fitness and age still move the threshold rather than remove it:
      `recoveryFactor` already folds in pace, fitness, experience, age and
      weight, so a lower-capability profile trips the rule sooner.
    */
    if (currentAltitude > ASCENT_RULE_FLOOR_M) {
      const ceiling = this.safeDailyGain(profile);
      const gain = currentDay.totalElevationGain;
      if (gain > ceiling) {
        breaks.push({
          afterIndex: pastDays.length,
          type: 'acclimatization',
          reason:
            `Climbed ${Math.round(gain)}m in one day above ` +
            `${ASCENT_RULE_FLOOR_M.toLocaleString()}m — an acclimatization day keeps the ascent safe`,
          mustBeStandalone: true,
        });
        // One acclimatization break per day is the whole point; stacking the
        // tolerance-based rules on top would double-insert for the same climb.
        return breaks;
      }
    }

    // Check altitude acclimatization — try within-day first
    if (currentAltitude > 2500) {
      const altDays = pastDays.filter(d => d.maxAltitude >= currentAltitude - 200).length;
      const tolerantEnough = profile.altitudeTolerance >= 0.8;

      if (currentAltitude > 4500 && altDays < 3 && !tolerantEnough) {
        breaks.push({
          afterIndex: pastDays.length,
          type: 'acclimatization',
          reason: 'Extended acclimatization needed at high altitude',
        });
      } else if (currentAltitude > 4000 && altDays < 2 && !tolerantEnough) {
        breaks.push({
          afterIndex: pastDays.length,
          type: 'acclimatization',
          reason: 'Additional acclimatization required above 4000m',
        });
      } else if (currentAltitude > 3000 && altDays < 1 && profile.altitudeTolerance < 0.7) {
        breaks.push({
          afterIndex: pastDays.length,
          type: 'acclimatization',
          reason: 'Altitude acclimatization needed above 3000m',
        });
      }
    }

    // Check upcoming difficult day
    if (nextDay && nextDay.totalElevationGain > 800 && profile.recoveryFactor < 1.0) {
      breaks.push({
        afterIndex: pastDays.length,
        type: 'recovery_break',
        reason: 'Prepare for difficult climb ahead',
      });
    }

    return breaks;
  }

  /**
   * The most a trekker should gain in one day above `ASCENT_RULE_FLOOR_M`.
   *
   * 600m is the conventional ceiling. `recoveryFactor` carries pace, fitness,
   * experience, age and weight, so a weaker profile gets a stricter limit —
   * banded rather than continuous so the same profile always produces the same
   * plan and the thresholds stay legible.
   */
  private safeDailyGain(profile: CapabilityProfile): number {
    const f = profile.recoveryFactor;
    if (f >= 0.9) return 600;
    if (f >= 0.7) return 550;
    if (f >= 0.5) return 500;
    return 450;
  }

  private tryInsertRecovery(
    days: ItineraryDay[],
    br: BreakSuggestion,
    profile: CapabilityProfile,
    altitude: number,
  ): number | null {
    if (days.length === 0) return null;

    const durationMap: Record<string, number> = {
      acclimatization: 2,
      recovery_break: 1,
      rest_day: 8,
    };
    const durationHours = durationMap[br.type] || 1;

    /**
     * Build the rest activity *for the day it will actually land in*.
     *
     * This used to be built once from the most recent day's end point and then
     * pushed into whichever day had room — including an earlier one. Since a
     * day's overnight location is its last activity's `to`, absorbing a break
     * into an earlier day rewrote that day's overnight to a place from later in
     * the trek, and the plan reported a route gap it did not have. A rest taken
     * on day 3 happens where day 3 ends, not where day 5 does.
     */
    const restAt = (dayIndex: number): ActivityDetail => {
      const host = days[dayIndex];
      const where = host.activities[host.activities.length - 1]?.to
        || host.overnightLocation
        || host.activities[0]?.from
        || '';
      return {
        type: br.type === 'rest_day' ? 'rest' : br.type,
        from: where,
        to: where,
        distance: 0,
        elevationGain: 0,
        durationHours,
        effortScore: 0,
        description: br.reason,
      };
    };

    const absorb = (dayIndex: number): number => {
      days[dayIndex].activities.push(restAt(dayIndex));
      this.updateDayTotals(days[dayIndex]);
      return dayIndex;
    };

    // Try same day (most recent) first
    const lastIdx = days.length - 1;
    if (days[lastIdx].totalHours + durationHours <= profile.maxDailyHours) {
      return absorb(lastIdx);
    }

    // Try adjacent day (second-most recent)
    const adjIdx = days.length - 2;
    if (adjIdx >= 0 && days[adjIdx].totalHours + durationHours <= profile.maxDailyHours) {
      return absorb(adjIdx);
    }

    // Try a nearby low-effort day. Scan BACKWARDS from the trigger and stop a
    // few days out: a break is caused by the day that precedes it, so it must
    // never be parked on an early day that happens to be light (which used to
    // strand an "above 4000m" acclimatization on day 1, at the wrong location).
    const floor = Math.max(0, days.length - 3);
    for (let i = lastIdx; i >= floor; i--) {
      if (i === lastIdx || i === adjIdx) continue;
      if (days[i].totalHours + durationHours <= profile.maxDailyHours * 0.7) {
        return absorb(i);
      }
    }

    return null;
  }

  private addBreaksWithinDay(activities: ActivityDetail[], profile: CapabilityProfile): ActivityDetail[] {
    const result: ActivityDetail[] = [];
    let hoursSinceBreak = 0;

    for (const activity of activities) {
      if (activity.type !== 'trekking') {
        result.push(activity);
        continue;
      }

      result.push(activity);
      hoursSinceBreak += activity.durationHours;

      if (hoursSinceBreak >= profile.breakIntervalHours) {
        result.push({
          type: 'recovery_break',
          from: activity.to,
          to: activity.to,
          distance: 0,
          elevationGain: 0,
          durationHours: 0.5,
          effortScore: 0,
          description: 'Short recovery break',
        });
        hoursSinceBreak = 0;
      }
    }

    return result;
  }

  private createRestDay(dayNumber: number, location: string, altitude: number, reason: string): ItineraryDay {
    return {
      day: dayNumber,
      activities: [{
        type: 'rest',
        from: location,
        to: location,
        distance: 0,
        elevationGain: 0,
        durationHours: 0,
        effortScore: 0,
        description: `Full rest day — ${reason}`,
      }],
      totalHours: 0,
      totalDistance: 0,
      totalElevationGain: 0,
      maxAltitude: altitude,
      overnightLocation: location,
      notes: [reason],
    };
  }

  private createAcclimatizationDay(
    dayNumber: number,
    location: string,
    altitude: number,
    mandatory = false,
  ): ItineraryDay {
    return {
      day: dayNumber,
      activities: [{
        type: 'acclimatization',
        from: location,
        to: location,
        distance: 0,
        elevationGain: 0,
        durationHours: 0,
        effortScore: 0,
        description: `Acclimatization day at ${altitude}m — short walks recommended`,
      }],
      totalHours: 0,
      totalDistance: 0,
      totalElevationGain: 0,
      maxAltitude: altitude + 100,
      overnightLocation: location,
      notes: [`Acclimatization at ${altitude}m`],
      mandatory,
    };
  }

  /**
   * Altitude reached by the end of a day, as cumulative positive elevation gain
   * carried forward from the previous day. The route stages record ascent only
   * (a descent is simply `elevationGain: 0`), so this tracks how high the trek
   * has climbed rather than a true above-sea-level altitude.
   */
  private estimateDayMaxAltitude(day: ItineraryDay, previousAltitude: number): number {
    let maxAlt = previousAltitude;
    for (const a of day.activities) {
      if (a.elevationGain > 0) maxAlt += a.elevationGain;
    }
    return maxAlt;
  }

  // ── Guess destination altitude from accumulated gain ──────────────────
  private guessDestinationAltitude(dest: string, elevationGain: number, route: RouteSegment[]): number {
    if (route.length === 0) return elevationGain;
    const lastAlt = route[route.length - 1].altitude || 0;
    return lastAlt + elevationGain;
  }

  // ── Final validation and output building ──────────────────────────────
  private finalize(
    days: ItineraryDay[],
    input: PersonalizationInput,
    profile: CapabilityProfile,
    baseDifficulty: number,
    trekName: string,
    origin: string,
    finalDest: string,
    baseDuration: number = days.length,
    explicitTarget: number | null = null,
  ): PersonalizedItinerary {
    const cautions: string[] = [];
    const adjustedDays = [...days];

    if (adjustedDays.length === 0) {
      return {
        trekName,
        totalDays: 0,
        totalDistance: 0,
        totalEffort: 0,
        maxAltitude: 0,
        suitability: 'Low',
        cautions: ['Cannot generate itinerary — no valid route'],
        origin: origin || 'Unknown',
        finalDestination: finalDest || 'Unknown',
        days: [],
        rejectionReason: 'No valid route could be constructed',
      };
    }

    // Set overnight locations
    for (let i = 0; i < adjustedDays.length; i++) {
      const day = adjustedDays[i];
      const lastActivity = day.activities[day.activities.length - 1];
      if (lastActivity) {
        day.overnightLocation = lastActivity.to;
      }
    }

    // Calculate max altitude
    let maxAltitude = 0;
    for (const day of adjustedDays) {
      if (day.maxAltitude > maxAltitude) maxAltitude = day.maxAltitude;
    }

    const totalDistance = Math.round(adjustedDays.reduce((s, d) => s + d.totalDistance, 0) * 10) / 10;
    const totalEffort = adjustedDays.reduce((s, d) => s + d.activities.reduce((sa, a) => sa + a.effortScore, 0), 0);

    // ── Validation checks ─────────────────────────────────────────────────
    //
    // Note: the "starting point was moved" check lives further down with the
    // other location reconciliation cautions. It used to be duplicated here as
    // well, which showed the user the same warning twice.

    // Compare generated days vs target (targeted mode only)
    if (explicitTarget != null && adjustedDays.length > explicitTarget + 1) {
      cautions.push(`Your itinerary is ${adjustedDays.length} days — slightly longer than your target of ${explicitTarget} days due to safety and route constraints.`);
    }

    // Couldn't stretch all the way to the target
    if (explicitTarget != null && adjustedDays.length < explicitTarget) {
      cautions.push(`Your itinerary comes to ${adjustedDays.length} days — this route doesn't have enough separate stages to fill ${explicitTarget} days without idle time.`);
    }

    // Warn if target was clamped (user requested more than max allowed)
    if (input.targetDays != null && explicitTarget != null && explicitTarget < input.targetDays) {
      cautions.push(`Your requested ${input.targetDays}-day plan has been adjusted to ${explicitTarget} days for a safe and enjoyable journey.`);
    }

    // Check excessive expansion relative to base duration
    const expansionThreshold = Math.max(4, Math.ceil(baseDuration * 0.4));
    if (adjustedDays.length > baseDuration + expansionThreshold) {
      cautions.push(`Your trek will take ${adjustedDays.length} days — longer than the typical ${baseDuration}-day plan. Take your time and enjoy the extra days!`);
    }

    // ── Day-specific notes (shown inside day card) ──────────────────────

    // Altitude gain too aggressive
    for (let i = 1; i < adjustedDays.length; i++) {
      const altGain = adjustedDays[i].maxAltitude - adjustedDays[i - 1].maxAltitude;
      if (altGain > 500 && adjustedDays[i].maxAltitude > 3000) {
        adjustedDays[i].notes.push(`Big climb of ${altGain}m today. Go slow, drink plenty of water, and listen to your body.`);
      }
    }

    // Daily effort exceeds capability
    for (const day of adjustedDays) {
      if (day.totalHours > profile.maxDailyHours + 1) {
        day.notes.push(`Long day (${day.totalHours}h). Start early and take regular breaks to keep your energy up.`);
      }
    }

    // Check too many consecutive difficult days (attach to last hard day)
    let hardCount = 0;
    let lastHardIdx = -1;
    for (let i = 0; i < adjustedDays.length; i++) {
      const day = adjustedDays[i];
      if (day.totalElevationGain > 500 || day.totalHours > 7) {
        hardCount++;
        lastHardIdx = i;
      } else {
        hardCount = 0;
      }
    }
    if (hardCount >= 5 && lastHardIdx >= 0) {
      adjustedDays[lastHardIdx].notes.push(`${hardCount} tough days in a row — consider adding a rest day to recharge.`);
    }

    // Check disconnected route
    if (adjustedDays.length > 1) {
      for (let i = 0; i < adjustedDays.length - 1; i++) {
        const currentEnd = adjustedDays[i].overnightLocation;
        const nextStart = adjustedDays[i + 1].activities[0]?.from || '';
        if (currentEnd && nextStart && this.normalizeLoc(currentEnd) !== this.normalizeLoc(nextStart)) {
          adjustedDays[i].notes.push(`Route gap: day ends at ${currentEnd} but next day starts at ${nextStart}.`);
        }
      }
    }

    // ── Global cautions ────────────────────────────────────────────────

    // Excessive rest days
    let restCount = 0;
    for (const day of adjustedDays) {
      if (day.activities.every(a => a.type === 'rest' || a.type === 'acclimatization')) {
        restCount++;
      }
    }
    if (restCount > 0) {
      const ratio = restCount / adjustedDays.length;
      if (ratio > 0.4) {
        cautions.push(`You have lots of rest days planned (${restCount} out of ${adjustedDays.length}). That's totally fine for a relaxed trip!`);
      }
    }

    // Check if first location matches user source
    if (origin && adjustedDays.length > 0) {
      const firstLoc = adjustedDays[0].activities[0]?.from || '';
      if (this.normalizeLoc(firstLoc) !== this.normalizeLoc(origin)) {
        cautions.push(`Your starting point has been updated from ${origin} to ${firstLoc} to align with the trek route.`);
      }
    }

    // Check if last location matches final destination
    if (finalDest && adjustedDays.length > 0) {
      const lastDay = adjustedDays[adjustedDays.length - 1];
      const lastLoc = lastDay.activities[lastDay.activities.length - 1]?.to || '';
      if (this.normalizeLoc(lastLoc) !== this.normalizeLoc(finalDest)) {
        cautions.push(`Your final destination has been updated to ${lastLoc} to match the trek route.`);
      }
    }

    // Determine suitability
    let suitability: 'Low' | 'Moderate' | 'High' = 'High';
    const hasConcerns = profile.recoveryFactor < 0.6 || input.age && input.age > 55 || input.weight && input.weight > 100;

    if (hasConcerns && baseDifficulty >= 3) {
      suitability = 'Low';
    } else if (hasConcerns && baseDifficulty >= 2) {
      suitability = 'Moderate';
    } else if (profile.recoveryFactor < 0.7 && baseDifficulty >= 2) {
      suitability = 'Moderate';
    }

    if (cautions.length > 2 && baseDifficulty >= 2) {
      suitability = 'Moderate';
    }

    return {
      trekName,
      totalDays: adjustedDays.length,
      totalDistance,
      totalEffort,
      maxAltitude,
      suitability,
      cautions,
      // Canonical spellings: someone who typed "bhaktapur" is planning from
      // Kathmandu, and the header strip should say so.
      origin: (origin && canonicalLocation(origin)) || adjustedDays[0]?.activities[0]?.from || 'Unknown',
      finalDestination:
        (finalDest && canonicalLocation(finalDest))
        || adjustedDays[adjustedDays.length - 1]?.overnightLocation
        || 'Unknown',
      days: adjustedDays,
    };
  }

  /**
   * ── Step 7: Fit the schedule to the target day count ────────────────────
   *
   * `hardTarget` distinguishes the two planning modes:
   *
   *  • `true`  — the caller asked for exactly this many days. Under-runs are
   *    padded up and over-runs are force-merged, even past what the capability
   *    profile would prefer.
   *
   *  • `false` — automatic mode, where `targetDays` is the trek's published
   *    duration. Under-runs are still padded up (a plan must never advertise
   *    fewer days than the trek itself), but an over-run is only compressed as
   *    far as the capability budgets safely allow. Days that survive are days
   *    this trekker genuinely needs, and silently merging them away would hand
   *    a beginner a schedule they cannot walk.
   */
  private fitToTarget(
    days: ItineraryDay[],
    profile: CapabilityProfile,
    targetDays: number,
    hardTarget: boolean,
  ): ItineraryDay[] {
    if (days.length === 0) return days;

    let current = days.map(d => this.cloneDay(d));

    // Always merge underutilized days and convert unnecessary rest
    current = this.mergeUnderutilizedDays(current, profile);
    current = this.convertUnnecessaryRestDays(current, profile);
    current = this.renumberDays(current);

    // Short of the target — scale out by splitting heavy days, then padding.
    if (current.length < targetDays) {
      return this.expandToTarget(current, targetDays);
    }
    if (current.length === targetDays) return current;

    // Over the target — compress within the capability budgets first.
    current = this.aggressiveCompress(current, profile);
    if (current.length <= targetDays) return this.renumberDays(current);

    // Automatic mode stops here: the remaining days are safety-driven.
    if (!hardTarget) return this.renumberDays(current);

    // Explicit target: force-merge to meet the number the user asked for.
    current = this.mergeToFitMax(current, profile, targetDays);
    current = this.renumberDays(current);

    // If still over target, pair-merge the smallest adjacent days.
    let safety = 0;
    while (current.length > targetDays && safety < MAX_ITINERARY_DAYS) {
      let bestIdx = -1;
      let minCombined = Infinity;
      for (let i = 0; i < current.length - 1; i++) {
        if (current[i].mandatory || current[i + 1].mandatory) continue;
        const combined = current[i].totalHours + current[i + 1].totalHours;
        if (combined < minCombined) {
          minCombined = combined;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      const merged = this.cloneDay(current[bestIdx]);
      for (const act of current[bestIdx + 1].activities) {
        merged.activities.push({ ...act });
      }
      this.updateDayTotals(merged);
      merged.overnightLocation = current[bestIdx + 1].overnightLocation;
      if (current[bestIdx + 1].maxAltitude > merged.maxAltitude) {
        merged.maxAltitude = current[bestIdx + 1].maxAltitude;
      }
      merged.notes.push(...current[bestIdx + 1].notes);
      current = [
        ...current.slice(0, bestIdx),
        merged,
        ...current.slice(bestIdx + 2),
      ];
      safety++;
    }

    return this.renumberDays(current);
  }

  // ── Step 7b: Scale a short schedule UP to the requested target ─────────
  // compressToTarget only ever merges days. When the user asks for more days
  // than the route naturally schedules into, we scale the plan up instead:
  // first by splitting the heaviest days into two gentler stages (real
  // itinerary scaling), then — once nothing is left to split — by inserting
  // rest / acclimatization days where they do the most good (padding).
  private expandToTarget(days: ItineraryDay[], targetDays: number): ItineraryDay[] {
    let current = days.map(d => this.cloneDay(d));
    const maxIterations = targetDays * 2 + 20;
    let safety = 0;

    while (current.length < targetDays && safety < maxIterations) {
      safety++;

      const split = this.findBestSplitPoint(current);
      if (split) {
        current = this.splitDayAt(current, split.dayIndex, split.activityIndex);
        continue;
      }

      const padded = this.insertPaddingDay(current);
      if (!padded) break; // nothing left we can safely add
      current = padded;
    }

    return this.renumberDays(current);
  }

  // Heaviest day that can be cut in two, and the most balanced place to cut it.
  private findBestSplitPoint(days: ItineraryDay[]): { dayIndex: number; activityIndex: number } | null {
    const carriesLoad = (a: ActivityDetail) => a.durationHours > 0 || a.distance > 0;
    let best: { dayIndex: number; activityIndex: number; load: number } | null = null;

    for (let d = 0; d < days.length; d++) {
      const acts = days[d].activities;
      if (acts.length < 2) continue;
      if (acts.filter(carriesLoad).length < 2) continue;

      const totalHours = acts.reduce((s, a) => s + a.durationHours, 0);
      let bestCut = -1;
      let bestImbalance = Infinity;
      let headHours = 0;

      for (let i = 0; i < acts.length - 1; i++) {
        headHours += acts[i].durationHours;
        const head = acts.slice(0, i + 1);
        const tail = acts.slice(i + 1);
        // Both halves must be a real day of their own
        if (!head.some(carriesLoad) || !tail.some(carriesLoad)) continue;

        const imbalance = Math.abs(headHours - (totalHours - headHours));
        if (imbalance < bestImbalance) {
          bestImbalance = imbalance;
          bestCut = i + 1;
        }
      }

      if (bestCut === -1) continue;

      const load = days[d].totalHours + days[d].totalElevationGain / 100;
      if (!best || load > best.load) {
        best = { dayIndex: d, activityIndex: bestCut, load };
      }
    }

    return best ? { dayIndex: best.dayIndex, activityIndex: best.activityIndex } : null;
  }

  private splitDayAt(days: ItineraryDay[], dayIndex: number, activityIndex: number): ItineraryDay[] {
    const original = days[dayIndex];
    const head = this.cloneDay(original);
    const tail = this.cloneDay(original);

    head.activities = original.activities.slice(0, activityIndex).map(a => ({ ...a }));
    tail.activities = original.activities.slice(activityIndex).map(a => ({ ...a }));

    this.updateDayTotals(head);
    this.updateDayTotals(tail);

    head.overnightLocation = head.activities[head.activities.length - 1]?.to || original.overnightLocation;
    tail.overnightLocation = original.overnightLocation;

    // Altitude accumulates through the day, so the tail keeps the day's peak and
    // the head peaks at whatever it had climbed to before the cut.
    const tailGain = tail.activities.reduce((s, a) => s + a.elevationGain, 0);
    head.maxAltitude = Math.max(0, original.maxAltitude - tailGain);
    tail.maxAltitude = original.maxAltitude;

    head.notes = [...original.notes];
    tail.notes = ['Shorter stage — this day was split so your trek fits your longer plan.'];

    return [...days.slice(0, dayIndex), head, tail, ...days.slice(dayIndex + 1)];
  }

  // Insert one rest / acclimatization day after whichever day benefits most.
  private insertPaddingDay(days: ItineraryDay[]): ItineraryDay[] | null {
    if (days.length === 0) return null;

    const isRestLike = (d: ItineraryDay) =>
      d.activities.length > 0 && d.activities.every(a => a.type === 'rest' || a.type === 'acclimatization');

    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < days.length; i++) {
      if (isRestLike(days[i])) continue;
      // Heaviest day wins, but heavily de-prioritise days that already have a
      // break after them so repeated padding spreads across the trek.
      const load = days[i].totalHours + days[i].totalElevationGain / 100;
      const score = days[i + 1] && isRestLike(days[i + 1]) ? load - 1000 : load;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) return null;

    const anchor = days[bestIdx];
    const location = anchor.overnightLocation
      || anchor.activities[anchor.activities.length - 1]?.to
      || '';
    const altitude = anchor.maxAltitude;

    const extra = altitude >= 3000
      ? this.createAcclimatizationDay(bestIdx + 2, location, altitude)
      : this.createRestDay(
          bestIdx + 2,
          location,
          altitude,
          'Extra day in your plan — take it easy and enjoy the surroundings',
        );

    return [...days.slice(0, bestIdx + 1), extra, ...days.slice(bestIdx + 1)];
  }

  /**
   * The trek's published duration, and the anchor every other duration rule is
   * derived from (the compression floor, the extension ceiling, and the
   * automatic-mode target).
   *
   * `stage.day` is the route data's own declaration of which day a stage falls
   * on, so the highest one *is* the trek length — and it matches `durationDays`
   * on the matching frontend destination for all 30 treks.
   *
   * This used to count only stages with `distance > 0 && estimatedHours > 0`,
   * which silently dropped every flight, drive and rest stage and so
   * under-reported the base for 25 of the 30 treks (Dolpo-Jomsom read as 14 days
   * instead of 20). Because the ceiling is a multiple of this number, the
   * undercount is what capped extension requests far below what was asked for.
   */
  private computeBaseDuration(stages: RouteStage[]): number {
    if (stages.length === 0) return 1;
    const declared = Math.max(...stages.map(s => s.day || 0));
    return Math.max(1, declared || stages.length);
  }

  private mergeUnderutilizedDays(days: ItineraryDay[], profile: CapabilityProfile): ItineraryDay[] {
    if (days.length <= 1) return days;

    const result: ItineraryDay[] = [];
    let i = 0;

    while (i < days.length) {
      const current = this.cloneDay(days[i]);
      const nextDay = i + 1 < days.length ? days[i + 1] : null;

      if (nextDay && this.canMergeDays(current, nextDay, profile)) {
        for (const act of nextDay.activities) {
          current.activities.push({ ...act });
        }
        this.updateDayTotals(current);
        current.overnightLocation = nextDay.overnightLocation;
        if (nextDay.maxAltitude > current.maxAltitude) {
          current.maxAltitude = nextDay.maxAltitude;
        }
        current.notes.push(...nextDay.notes);
        i += 2;
      } else {
        i += 1;
      }
      result.push(current);
    }

    return result;
  }

  private canMergeDays(dayA: ItineraryDay, dayB: ItineraryDay, profile: CapabilityProfile): boolean {
    // A mandated acclimatization day only works as a day. See `ItineraryDay.mandatory`.
    if (dayA.mandatory || dayB.mandatory) return false;
    if (dayA.totalHours >= profile.maxDailyHours * 0.5) return false;

    const combinedHours = dayA.totalHours + dayB.totalHours;
    if (combinedHours > profile.maxDailyHours) return false;

    const effortA = dayA.activities.reduce((s, a) => s + a.effortScore, 0);
    const effortB = dayB.activities.reduce((s, a) => s + a.effortScore, 0);
    if (effortA + effortB > profile.maxEffortPerDay) return false;

    const combinedElevation = dayA.totalElevationGain + dayB.totalElevationGain;
    if (combinedElevation > profile.maxElevationPerDay) return false;

    return true;
  }

  private convertUnnecessaryRestDays(days: ItineraryDay[], profile: CapabilityProfile): ItineraryDay[] {
    const result: ItineraryDay[] = [];

    for (let i = 0; i < days.length; i++) {
      const day = this.cloneDay(days[i]);
      const isPureRestDay = day.activities.every(a => a.type === 'rest' || a.type === 'acclimatization');
      const prevDay = result.length > 0 ? result[result.length - 1] : null;

      // A mandated acclimatization day is by definition necessary.
      if (isPureRestDay && prevDay && !day.mandatory) {
        const restActivity = day.activities[0];
        const isAcclimatization = restActivity.type === 'acclimatization';

        // Rule 3: Acclimatization days require justification
        if (isAcclimatization) {
          const altGain = day.maxAltitude - prevDay.maxAltitude;
          const lowGain = altGain < 300;
          const highTolerance = profile.altitudeTolerance >= 0.8;
          const fitsInPrevDay = prevDay.totalHours + 2 <= profile.maxDailyHours;

          if ((lowGain || highTolerance) && fitsInPrevDay) {
            prevDay.activities.push({
              type: 'recovery_break',
              from: restActivity.from || prevDay.overnightLocation,
              to: restActivity.to || prevDay.overnightLocation,
              distance: 0,
              elevationGain: 0,
              durationHours: 1.5,
              effortScore: 0,
              description: 'Recovery period — acclimatization',
            });
            this.updateDayTotals(prevDay);
            continue;
          }
        }

        // Rule 4: Hard-climb recovery should prefer existing days
        if (!isAcclimatization) {
          const nextDay = i + 1 < days.length ? days[i + 1] : null;
          const hasHardClimbAhead = nextDay && nextDay.activities.some(a => a.elevationGain > 300);
          const hasCapacity = prevDay.totalHours + 3 <= profile.maxDailyHours;

          if (hasHardClimbAhead && hasCapacity) {
            prevDay.activities.push({
              type: 'recovery_break',
              from: prevDay.overnightLocation,
              to: prevDay.overnightLocation,
              distance: 0,
              elevationGain: 0,
              durationHours: 2,
              effortScore: 0,
              description: 'Extended recovery before difficult section',
            });
            this.updateDayTotals(prevDay);
            continue;
          }
        }
      }

      result.push(day);
    }

    return result;
  }

  private aggressiveCompress(days: ItineraryDay[], profile: CapabilityProfile): ItineraryDay[] {
    if (days.length <= 1) return days;

    const result: ItineraryDay[] = [];
    let i = 0;

    while (i < days.length) {
      const current = this.cloneDay(days[i]);
      let j = i + 1;

      while (j < days.length) {
        const nextDay = days[j];
        if (current.mandatory || nextDay.mandatory) break;

        const combinedHours = current.totalHours + nextDay.totalHours;
        const effortA = current.activities.reduce((s, a) => s + a.effortScore, 0);
        const effortB = nextDay.activities.reduce((s, a) => s + a.effortScore, 0);
        const combinedEffort = effortA + effortB;
        const combinedElevation = current.totalElevationGain + nextDay.totalElevationGain;

        if (combinedHours <= profile.maxDailyHours &&
            combinedEffort <= profile.maxEffortPerDay &&
            combinedElevation <= profile.maxElevationPerDay) {
          for (const act of nextDay.activities) {
            current.activities.push({ ...act });
          }
          this.updateDayTotals(current);
          current.overnightLocation = nextDay.overnightLocation;
          if (nextDay.maxAltitude > current.maxAltitude) {
            current.maxAltitude = nextDay.maxAltitude;
          }
          current.notes.push(...nextDay.notes);
          j++;
        } else {
          break;
        }
      }

      result.push(current);
      i = j;
    }

    return result;
  }

  private mergeToFitMax(days: ItineraryDay[], profile: CapabilityProfile, maxDays: number): ItineraryDay[] {
    if (days.length <= maxDays) return days;

    let current = this.mergeUnderutilizedDays(days, profile);
    if (current.length <= maxDays) return current;

    current = this.aggressiveCompress(current, profile);
    if (current.length <= maxDays) return current;

    while (current.length > maxDays) {
      let bestIdx = -1;
      let minHours = Infinity;

      for (let i = 0; i < current.length - 1; i++) {
        if (current[i].mandatory || current[i + 1].mandatory) continue;
        const combined = current[i].totalHours + current[i + 1].totalHours;
        if (combined < minHours) {
          minHours = combined;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;

      const merged = this.cloneDay(current[bestIdx]);
      const nextDay = current[bestIdx + 1];
      for (const act of nextDay.activities) {
        merged.activities.push({ ...act });
      }
      this.updateDayTotals(merged);
      merged.overnightLocation = nextDay.overnightLocation;
      if (nextDay.maxAltitude > merged.maxAltitude) {
        merged.maxAltitude = nextDay.maxAltitude;
      }
      merged.notes.push(...nextDay.notes);

      current = [
        ...current.slice(0, bestIdx),
        merged,
        ...current.slice(bestIdx + 2),
      ];
    }

    return current;
  }

  private renumberDays(days: ItineraryDay[]): ItineraryDay[] {
    return days.map((d, i) => ({ ...d, day: i + 1 }));
  }

  private cloneDay(day: ItineraryDay): ItineraryDay {
    return {
      ...day,
      activities: day.activities.map(a => ({ ...a })),
      notes: [...day.notes],
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  private difficultyToNumber(difficulty: string): number {
    const map: Record<string, number> = { easy: 1, moderate: 2, hard: 3 };
    return map[difficulty.toLowerCase()] || 2;
  }

  /**
   * A location reduced to the identity used for "is this the same place?"
   * comparisons — route continuity, and whether a transfer leg is needed at
   * all. Delegates to the transport hub table so every alias it knows (the
   * whole Kathmandu valley, Bharatpur for Chitwan) collapses correctly.
   */
  private normalizeLoc(loc: string): string {
    return canonicalLocation(loc).toLowerCase();
  }

  private expandAbbr(val: string): string {
    let result = val;
    for (const [abbr, full] of Object.entries(ABBR_MAP)) {
      result = result.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
    }
    return result;
  }
}
