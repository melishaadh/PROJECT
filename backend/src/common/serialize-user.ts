import { UserDocument } from '@db/schemas/user.schema';
import { DEFAULT_AGE_BRACKET, ageBracketFor, ageGroupFromDob, calculateAge } from '@/common/age';

/**
 * Flattens a User document into the shape the Expo client expects
 * (see AuthContext.ApiUser). The client reads profile/preferences as
 * top-level fields, so we spread the embedded objects up here.
 *
 * `ageGroup` is derived from the stored date of birth on every read rather
 * than served from the frozen `profile.ageGroup`, so the profile vector keeps
 * itself current as the user ages. Accounts with no DOB on record fall back to
 * whatever they picked during onboarding.
 *
 * This is the *self* view — it is only ever returned to the account it belongs
 * to. `dateOfBirth` and the derived `age` are in here because onboarding needs
 * them; they are deliberately absent from `getPublicProfile`, which is what
 * another member sees. Age is confidential and exists for the KNN and safety
 * matrices, not for display.
 *
 * `password` and `profilePictureKey` are `select: false` on the schema, so they
 * are not loaded in the first place and cannot leak through here by omission.
 */
export function serializeUser(user: UserDocument) {
  const profile = user.profile ?? ({} as any);
  const preferences = user.preferences ?? ({} as any);
  const dob = user.dateOfBirth ?? null;
  const age = calculateAge(dob);
  const ageGroup = ageGroupFromDob(dob, profile.ageGroup ?? DEFAULT_AGE_BRACKET);
  const bracket = ageBracketFor(ageGroup);

  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name ?? null,
    bio: user.bio ?? '',
    socialMediaLink: user.socialMediaLink ?? '',
    profilePicture: user.profilePicture ?? '',
    dateOfBirth: dob ? new Date(dob).toISOString() : null,
    age,
    completedTrekIds: user.completedTrekIds ?? [],
    /** Mirror of the user's likes, so the client can hydrate hearts instantly. */
    likedTrekIds: user.likedTrekIds ?? [],
    ageGroup,
    /**
     * The bracket's own identity, sent alongside the index so the client renders
     * the cohort name and range the engine actually clustered on rather than
     * indexing into a local table that could drift from this one.
     */
    ageBracketKey: bracket.key,
    ageBracketLabel: bracket.label,
    ageBracketRange: bracket.rangeLabel,
    /** True when the bucket is computed from DOB and therefore not user-editable. */
    ageGroupDerived: age !== null,
    experienceLevel: profile.experienceLevel ?? 1,
    cardioFlag: profile.cardioFlag ?? 1,
    jointFlag: profile.jointFlag ?? 1,
    altitudeHistory: profile.altitudeHistory ?? 1,
    ageGroupLocked: age !== null || (user.ageGroupLocked ?? false),
    maxDuration: preferences.maxDuration ?? 21,
    maxPrice: preferences.maxPrice ?? 300000,
    difficulty: preferences.difficulty ?? 'All',
    isOnboarded: user.isOnboarded ?? false,
    lastLogin: user.lastLogin ?? null,
  };
}
