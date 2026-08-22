import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TREK_ROUTE_BY_ID, allLocations } from '@/data/trek-routes';
import { TRANSPORT_HUBS } from '@/data/transport';
import { calculateAge } from '@/common/age';
import { TREK_BY_ID } from '@/data/trek-metadata';
import { UsersService } from '@/modules/users/users.service';
import { UserDocument } from '@db/schemas/user.schema';
import {
  PersonalizationService,
  PersonalizationInput,
  PersonalizedItinerary,
} from './personalization.service';

/**
 * Sent when a signed-in account asks for an itinerary before saving its
 * preferences. The client turns this into the "set your preferences first"
 * guard, so the wording is the contract between the two.
 */
export const PREFERENCES_REQUIRED_MESSAGE =
  'Set and save your trek preferences before generating an itinerary.';

export interface GenerateItineraryDto {
  trekId: string;
  pace?: string;
  fitnessLevel?: string;
  trekkingExperience?: string;
  targetDays?: number;
  age?: number;
  weight?: number;
  groupSize?: number;
  startLocation?: string;
  finalDestination?: string;
}

/**
 * The onboarding profile's 0-3 experience scale, in the engine's terms.
 * Index is `profile.experienceLevel`.
 */
const EXPERIENCE_BY_LEVEL: PersonalizationInput['trekkingExperience'][] = [
  'none', 'basic', 'moderate', 'extensive',
];

/**
 * Fitness inferred from the two health flags the onboarding form captures.
 *
 * The profile has no explicit fitness field — it records cardio and joint
 * condition as Poor/Good. Both good reads as `advanced`, one as
 * `intermediate`, neither as `beginner`. Deliberately conservative: this is
 * only a fallback for when the planning form left fitness blank, and
 * over-estimating it inflates the daily budgets a plan is built against.
 */
function fitnessFromFlags(cardio: number, joint: number): PersonalizationInput['fitnessLevel'] {
  const good = (cardio === 1 ? 1 : 0) + (joint === 1 ? 1 : 0);
  return good === 2 ? 'advanced' : good === 1 ? 'intermediate' : 'beginner';
}

@Injectable()
export class ItineraryService {
  constructor(
    private readonly personalizationService: PersonalizationService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Stateless, on-demand itinerary generation — mirrors how the recommendation
   * engine computes without persisting. Route data comes from the static
   * trek-routes catalogue (ids aligned with the frontend DESTINATIONS).
   *
   * Refuses outright until the account has saved its preferences. An itinerary
   * is a personalised artefact; generating one from unset defaults would look
   * like a real plan while describing nobody.
   */
  async generate(userId: string, dto: GenerateItineraryDto): Promise<PersonalizedItinerary> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isOnboarded) throw new ForbiddenException(PREFERENCES_REQUIRED_MESSAGE);

    const route = TREK_ROUTE_BY_ID.get(String(dto.trekId));
    if (!route) throw new NotFoundException('Trek not found');

    // The catalogue's peak altitude anchors the engine's altitude model to real
    // metres rather than cumulative gain — see `inferStartAltitude`.
    const peakAltitude = TREK_BY_ID.get(String(dto.trekId))?.maxAltitude;

    return this.personalizationService.generate(
      route.name,
      route.difficulty,
      route.routeStages,
      this.resolveInput(dto, user),
      peakAltitude,
    );
  }

  /**
   * Combine the saved profile with whatever the planning form supplied.
   *
   * **Precedence is always: active form input → stored profile → engine
   * default.** The profile is a starting point, not an authority. Someone
   * planning a trek for next spring may be fitter than when they onboarded, or
   * planning around an injury that is not on their record, and the form in
   * front of them has to win — otherwise a "personalised" plan quietly ignores
   * what the user just typed. Equally, leaving a field blank should not throw
   * away what the account already knows and fall back to a generic beginner.
   *
   * Note `weight` has no profile source: the onboarding form never captures it,
   * so it is form-only and simply stays undefined when not given.
   */
  private resolveInput(dto: GenerateItineraryDto, user: UserDocument): PersonalizationInput {
    const profile = user.profile;

    const profileExperience =
      profile && Number.isInteger(profile.experienceLevel)
        ? EXPERIENCE_BY_LEVEL[Math.max(0, Math.min(3, profile.experienceLevel))]
        : undefined;

    const profileFitness = profile
      ? fitnessFromFlags(profile.cardioFlag, profile.jointFlag)
      : undefined;

    // Derived from the date of birth rather than stored, so it stays current.
    const profileAge = calculateAge(user.dateOfBirth) ?? undefined;

    return {
      pace: (dto.pace as PersonalizationInput['pace']) || 'normal',
      fitnessLevel:
        (dto.fitnessLevel as PersonalizationInput['fitnessLevel']) ||
        profileFitness ||
        'beginner',
      trekkingExperience:
        (dto.trekkingExperience as PersonalizationInput['trekkingExperience']) ||
        profileExperience ||
        'none',
      targetDays: dto.targetDays,
      age: dto.age ?? profileAge,
      weight: dto.weight,
      groupSize: dto.groupSize,
      // History always comes from the profile — it is a record of what the user
      // has done, not something the planning form should be able to assert.
      completedTrekIds: Array.isArray(user.completedTrekIds) ? user.completedTrekIds : [],
      startLocation: dto.startLocation,
      finalDestination: dto.finalDestination,
    };
  }

  /**
   * The place names offered by the planner's "Starting From" / "Finishing At"
   * autocomplete.
   *
   * Two sources, because they answer two different questions. `allLocations()`
   * harvests the names out of the route stages — trailheads, villages,
   * checkpoints, rest stops — which is everywhere a trek *passes through*. On
   * its own that is the wrong list for these two fields: nobody starts a trip
   * from a rest stop halfway up the Khumbu, and the towns people really do
   * travel from (Biratnagar, Bhairahawa, Dharan, Chitwan…) appear in no route
   * at all, so typing one returned an empty dropdown.
   *
   * `TRANSPORT_HUBS` is exactly that missing set — the places `planTransfer`
   * can actually route a traveller from — so the union is what the field should
   * have been offering all along.
   *
   * Hub *aliases* are offered too, not just canonical names. Somebody who lives
   * in Bhaktapur types "Bhaktapur", not "Kathmandu", and an autocomplete that
   * only knows the canonical name leaves them staring at an empty dropdown for
   * a place the planner understands perfectly well. Committing an alias is
   * safe: `resolveHub` maps it back to its hub for planning, and
   * `canonicalLocation` is what the finished itinerary displays — so picking
   * "Bhaktapur" plans, and reads back, as Kathmandu.
   */
  getLocations(): string[] {
    const aliases = TRANSPORT_HUBS.flatMap(h => (h.aliases ?? []).map(displayAlias));
    const byName = new Map<string, string>();
    // Order matters: the first spelling of a name wins the case-insensitive
    // de-dupe, so a hub a route already mentions keeps the route's spelling.
    for (const name of [...allLocations(), ...TRANSPORT_HUBS.map(h => h.name), ...aliases]) {
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, name);
    }
    return Array.from(byName.values()).sort((a, b) => a.localeCompare(b));
  }
}

/**
 * Present a hub alias the way a place name should look in a dropdown.
 *
 * Aliases are stored lowercased because that is the form `resolveHub` matches
 * against, which is right for lookup and wrong for display — a list offering
 * "bhaktapur" next to "Bhaktapur Ghat" reads as a bug. Short entries are
 * airport-style codes rather than words, so they are upper-cased instead:
 * "ktm" is meant to be seen as KTM.
 */
function displayAlias(alias: string): string {
  const trimmed = alias.trim();
  return trimmed.length <= 3
    ? trimmed.toUpperCase()
    : trimmed.replace(/\b\p{Ll}/gu, c => c.toUpperCase());
}
