import { Injectable, BadRequestException, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserProfile, UserPreferences, PROFILE_RANGES } from '@db/schemas/user.schema';
import {
  DEFAULT_AGE_BRACKET,
  MIN_BRACKET_AGE,
  ageGroupFromAge,
  ageGroupFromDob,
  calculateAge,
} from '@/common/age';
import { UserInteraction, UserInteractionDocument } from '@db/schemas/user-interaction.schema';
import { DestinationsService } from '@/modules/destinations/destinations.service';
import { TREK_METADATA } from '@/data/trek-metadata';
import { CACHE_TTL, CacheService, CacheTag } from '@/common/cache.service';
import { StorageService } from '@/common/storage.service';
import { validateImageUpload } from '@/common/image-upload';

export interface SearchUserResult {
  id: string;
  username: string;
  bio: string;
  socialMediaLink: string;
  profilePicture: string;
  completedTrekIds: string[];
}

/** Catalogue ids, so a completed-trek list cannot hold arbitrary strings. */
const KNOWN_TREK_IDS = new Set(TREK_METADATA.map(t => t.trekId));

/**
 * Ceiling on a single reported dwell, at 60s. The client sends elapsed
 * on-screen time, and a backgrounded app or a card left open while the user
 * walked away would otherwise report hours of "interest" and swamp every real
 * signal. Clamped server-side because the client's number is untrusted.
 */
const MAX_SIGNAL_DWELL_MS = 60_000;

/** Neutralise regex metacharacters so user text is matched literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalise a social-media link to a safe absolute https URL, or empty.
 *
 * The profile screen renders this straight into `Linking.openURL`, so a
 * `javascript:` or `data:` scheme stored here would execute on tap. Only http
 * and https survive; a bare `instagram.com/x` is upgraded to https rather than
 * rejected, because typing the scheme is not something users do.
 */
function normalizeSocialLink(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(UserInteraction.name) private interactionModel: Model<UserInteractionDocument>,
    private readonly destinationsService: DestinationsService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Repair the denormalised like counters on the destination documents.
   *
   * The interaction collection is the source of truth and each like/unlike
   * mirrors itself onto the destination as it happens — but a request that died
   * mid-write, or likes inserted outside the API, would leave the two out of
   * step. Recomputing once at boot means the trending leaderboard and the
   * popularity layer always start from a correct counter. DestinationsModule is
   * a dependency of this module, so its catalogue seed has already run by here.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.destinationsService.syncLikeCounts(await this.getAllLikeCounts());
      const repaired = await this.syncLikedTrekIds();
      if (repaired > 0) {
        this.logger.log(`Repaired likedTrekIds for ${repaired} user(s)`);
      }
      const unlocked = await this.unlockUnderivableAgeBrackets();
      if (unlocked > 0) {
        this.logger.log(`Unlocked the age bracket for ${unlocked} account(s) with no date of birth`);
      }
    } catch (error) {
      this.logger.error(`Like-state resync failed: ${(error as Error).message}`);
    }
  }

  /**
   * Let accounts with no date of birth re-pick their peer bracket.
   *
   * Every account created through signup stores a DOB, so its bracket is derived
   * fresh on every read and is correct by construction. Accounts predating DOB
   * capture have only the number they chose during onboarding — and that number
   * was written against a different set of bands than the five tailored brackets
   * the form now offers, so continuing to present it as a *locked* cohort would
   * be asserting something the data does not support.
   *
   * The stored index is deliberately left alone: it is still the user's best
   * available bracket and there is no honest remapping (the old "25–45" band
   * spans three of the new brackets on its own). Only the lock is lifted, which
   * turns an unverifiable claim into an editable answer the user can correct in
   * one tap. `updateProfile` re-locks it as soon as they do.
   *
   * Idempotent, so re-running it on every boot costs one indexed no-op update.
   */
  async unlockUnderivableAgeBrackets(): Promise<number> {
    const result = await this.userModel
      .updateMany(
        {
          ageGroupLocked: true,
          $or: [{ dateOfBirth: null }, { dateOfBirth: { $exists: false } }],
        },
        { $set: { ageGroupLocked: false } }
      )
      .exec();
    return result.modifiedCount ?? 0;
  }

  private validateUserProfile(profile: UserProfile): void {
    const errors: string[] = [];
    const checks: [keyof UserProfile, keyof typeof PROFILE_RANGES][] = [
      ['ageGroup', 'ageGroup'],
      ['experienceLevel', 'experienceLevel'],
      ['cardioFlag', 'cardioFlag'],
      ['jointFlag', 'jointFlag'],
      ['altitudeHistory', 'altitudeHistory'],
    ];

    for (const [field, rangeKey] of checks) {
      const range = PROFILE_RANGES[rangeKey];
      const value = Number(profile[field]);
      if (!Number.isInteger(value) || value < range.min || value > range.max) {
        errors.push(`${field} must be an integer between ${range.min} and ${range.max}`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(`Invalid profile: ${errors.join('; ')}`);
    }
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByName(name: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ name }).exec();
  }

  /**
   * Autocomplete over usernames, Instagram-style.
   *
   * Runs two indexed passes against `nameLower`: an anchored `^prefix` match
   * (an index range scan) first, then a substring match to fill the remaining
   * slots. Prefix hits therefore always rank above mid-word hits, which is what
   * makes an as-you-type list feel correct.
   */
  async searchByName(query: string, limit = 15): Promise<SearchUserResult[]> {
    // Coerced to a primitive before anything else: Express turns `?q[$ne]=x`
    // into an object, and an object reaching `$regex` is a NoSQL injection.
    const q = (typeof query === 'string' ? query : '').trim().toLowerCase().slice(0, 64);
    if (!q) return [];
    const escaped = escapeRegex(q);
    const projection = 'name bio socialMediaLink profilePicture completedTrekIds';

    const prefixMatches = await this.userModel
      .find({ nameLower: { $regex: `^${escaped}` } })
      .select(projection)
      .sort({ nameLower: 1 })
      .limit(limit)
      .exec();

    const seen = new Set(prefixMatches.map(u => u._id.toString()));
    let combined = prefixMatches;

    if (combined.length < limit) {
      const substringMatches = await this.userModel
        .find({
          _id: { $nin: Array.from(seen).map(id => new Types.ObjectId(id)) },
          nameLower: { $regex: escaped },
        })
        .select(projection)
        .sort({ nameLower: 1 })
        .limit(limit - combined.length)
        .exec();
      combined = [...combined, ...substringMatches];
    }

    return combined.map((u: any) => ({
      id: u._id.toString(),
      username: u.name,
      bio: u.bio ?? '',
      socialMediaLink: u.socialMediaLink ?? '',
      profilePicture: u.profilePicture ?? '',
      completedTrekIds: u.completedTrekIds ?? [],
    }));
  }

  /**
   * Public profile view for a searched user — everything the profile sheet
   * renders, and nothing else (no email, no password, no preferences).
   */
  async getPublicProfile(id: string): Promise<SearchUserResult | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const u: any = await this.userModel
      .findById(id)
      .select('name bio socialMediaLink profilePicture completedTrekIds')
      .exec();
    if (!u) return null;
    return {
      id: u._id.toString(),
      username: u.name,
      bio: u.bio ?? '',
      socialMediaLink: u.socialMediaLink ?? '',
      profilePicture: u.profilePicture ?? '',
      completedTrekIds: u.completedTrekIds ?? [],
    };
  }

  async updateProfile(
    userId: string,
    profile: UserProfile,
    preferences?: Partial<UserPreferences>
  ): Promise<UserDocument | null> {
    this.validateUserProfile(profile);

    const current = await this.userModel
      .findById(userId)
      .select('ageGroupLocked profile dateOfBirth')
      .exec();
    const finalProfile: UserProfile = { ...profile };

    // A stored date of birth always wins: the bucket is computed, never picked.
    // Otherwise the age group is captured once during onboarding and locked.
    const derived = calculateAge(current?.dateOfBirth);
    if (derived !== null) {
      finalProfile.ageGroup = ageGroupFromAge(derived);
    } else if (current?.ageGroupLocked && current.profile) {
      finalProfile.ageGroup = current.profile.ageGroup;
    }

    const update: Record<string, any> = {
      $set: { profile: finalProfile, isOnboarded: true, ageGroupLocked: true },
    };
    if (preferences) {
      update.$set.preferences = preferences;
    }

    const updated = await this.userModel.findByIdAndUpdate(userId, update, { new: true }).exec();

    // The profile vector and the stated preferences are both inputs to the For
    // You ranking, which is cached per user. Without this the feed would keep
    // serving the pre-change ranking until the TTL lapsed — so saving
    // preferences would appear to do nothing for the next several seconds,
    // which is precisely when the user is looking for the effect.
    this.cache.invalidate(`user:${userId}`);
    return updated;
  }

  /**
   * Update the editable identity fields for the *authenticated* user.
   *
   * `userId` is the JWT subject supplied by the controller. Note what is
   * deliberately absent: `profilePicture` is no longer writable here. It is set
   * exclusively by `setProfilePicture`, which validates real image bytes and
   * puts them in object storage — leaving it as a free-text field would let any
   * caller PATCH an arbitrary string (a base64 blob, or a URL pointing anywhere
   * at all) straight into a field the app renders as an image.
   */
  async updateIdentityFields(
    userId: string,
    fields: {
      name?: string;
      bio?: string;
      socialMediaLink?: string;
      completedTrekIds?: string[];
      dateOfBirth?: string | null;
    }
  ): Promise<UserDocument | null> {
    const objectId = this.toObjectId(userId);
    const update: Record<string, any> = { $set: {} };

    if (fields.name !== undefined) {
      const name = fields.name.trim();
      if (!name) throw new BadRequestException('Username cannot be empty');
      update.$set.name = name;
      // findByIdAndUpdate bypasses the `save` hook, so mirror it explicitly.
      update.$set.nameLower = name.toLowerCase();
    }
    if (fields.bio !== undefined) update.$set.bio = fields.bio.trim();
    if (fields.socialMediaLink !== undefined) {
      update.$set.socialMediaLink = normalizeSocialLink(fields.socialMediaLink);
    }
    if (fields.completedTrekIds !== undefined) {
      // Only ids that exist in the catalogue, de-duplicated. Without this the
      // field is an arbitrary attacker-controlled string array stored verbatim.
      update.$set.completedTrekIds = Array.from(
        new Set(fields.completedTrekIds.filter(id => KNOWN_TREK_IDS.has(id)))
      );
    }

    // Setting a DOB re-derives the age group immediately and locks the picker.
    if (fields.dateOfBirth !== undefined) {
      const age = calculateAge(fields.dateOfBirth);
      if (fields.dateOfBirth === null) {
        update.$set.dateOfBirth = null;
      } else if (age === null) {
        throw new BadRequestException('dateOfBirth is not a valid date');
      } else if (age < MIN_BRACKET_AGE) {
        // The same floor `register` enforces. Without it, an account could be
        // created at a legal age and then edited below the bracket floor,
        // reaching by the back door exactly what signup refuses at the front.
        throw new BadRequestException(
          `You must be at least ${MIN_BRACKET_AGE} years old to use TrekEasy.`
        );
      } else {
        update.$set.dateOfBirth = new Date(fields.dateOfBirth);
        update.$set['profile.ageGroup'] = ageGroupFromAge(age);
        update.$set.ageGroupLocked = true;
      }
    }

    if (Object.keys(update.$set).length === 0) {
      return this.userModel.findById(objectId).exec();
    }

    const updated = await this.userModel.findByIdAndUpdate(objectId, update, { new: true }).exec();
    this.cache.invalidate(`user:${userId}`);
    return updated;
  }

  // ─── Profile picture ───────────────────────────────────────────────────────

  /**
   * Replace a user's profile picture.
   *
   * `userId` always comes from the verified JWT subject, never from the request
   * body or path — there is no parameter here that could name a *different*
   * account, which is what makes cross-account overwrite impossible by
   * construction rather than by a check that could be forgotten.
   *
   * The old object is deleted only after the new one is safely stored, so a
   * failed upload leaves the existing picture intact rather than clearing it.
   */
  async setProfilePicture(
    userId: string,
    file: { buffer?: Buffer; size?: number; mimetype?: string } | undefined
  ): Promise<UserDocument> {
    const objectId = this.toObjectId(userId);
    const { buffer, extension } = validateImageUpload(file);

    const existing = await this.userModel
      .findById(objectId)
      .select('+profilePictureKey')
      .exec();
    if (!existing) throw new NotFoundException('User not found');

    const stored = await this.storage.storeImage(buffer, extension);

    const updated = await this.userModel
      .findByIdAndUpdate(
        objectId,
        { $set: { profilePicture: stored.url, profilePictureKey: stored.key } },
        { new: true }
      )
      .exec();

    if (!updated) {
      // The account vanished between the read and the write — don't leave the
      // freshly uploaded object orphaned in storage.
      await this.storage.deleteImage(stored.key);
      throw new NotFoundException('User not found');
    }

    // Best-effort, and deliberately after the successful write.
    await this.storage.deleteImage((existing as any).profilePictureKey);
    return updated;
  }

  /** Remove the current picture and delete the stored object. */
  async removeProfilePicture(userId: string): Promise<UserDocument> {
    const objectId = this.toObjectId(userId);
    const existing = await this.userModel
      .findById(objectId)
      .select('+profilePictureKey')
      .exec();
    if (!existing) throw new NotFoundException('User not found');

    const updated = await this.userModel
      .findByIdAndUpdate(
        objectId,
        { $set: { profilePicture: '', profilePictureKey: '' } },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('User not found');

    await this.storage.deleteImage((existing as any).profilePictureKey);
    return updated;
  }

  /**
   * Delete everything account deletion owns outside the user document itself:
   * every like/view/dismiss interaction, and the stored profile picture (if
   * any). Called before `AuthService.deleteUserAccount` removes the document
   * and the refresh grants, so nothing here is left orphaned by that step.
   *
   * `profilePictureKey` is passed in rather than re-fetched: the caller
   * (`UsersController.deleteAccount`) already loaded the user with that field
   * selected while confirming the password, and it is marked `select: false`
   * on the schema — a second, separate fetch would be needed to read it again.
   */
  async purgeUserData(userId: string, profilePictureKey?: string | null): Promise<void> {
    const objectId = this.toObjectId(userId);
    await this.interactionModel.deleteMany({ userId: objectId }).exec();
    if (profilePictureKey) {
      await this.storage.deleteImage(profilePictureKey);
    }
    this.cache.invalidate(CacheTag.LIKES, `user:${userId}`);
  }

  /**
   * The completed-trek list is an input to the For You ranking — it reinforces
   * the long-term half of the behavioural affinity — and that ranking is cached
   * per user, so both mutators below invalidate the user's feed entry. Without
   * it, marking a trek complete would appear to do nothing to the feed until the
   * TTL lapsed, which is exactly when the user is looking for the effect.
   */
  async addCompletedTrek(userId: string, trekId: string): Promise<UserDocument | null> {
    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $addToSet: { completedTrekIds: trekId } },
      { new: true }
    ).exec();
    this.cache.invalidate(`user:${userId}`);
    return updated;
  }

  async removeCompletedTrek(userId: string, trekId: string): Promise<UserDocument | null> {
    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $pull: { completedTrekIds: trekId } },
      { new: true }
    ).exec();
    this.cache.invalidate(`user:${userId}`);
    return updated;
  }

  // ─── Like / Interaction methods ────────────────────────────────────────────

  /**
   * Record a like — idempotent and race-free.
   *
   * Three properties combine to guarantee exactly one like per user per trek,
   * no matter how many taps arrive concurrently:
   *
   *   1. The `{userId, trekId, type}` **unique index** on the interactions
   *      collection is the hard constraint. Even two requests that both observe
   *      "not yet liked" cannot both insert — the second is rejected by the
   *      index rather than producing a duplicate.
   *   2. A single **atomic upsert** rather than a find-then-insert pair. The
   *      read-then-write version raced against itself on a double-tap and lost
   *      one of the writes to that index as a 409; the upsert makes re-liking a
   *      silent no-op, which is the correct semantics for an idempotent action.
   *   3. `$addToSet` on the user's `likedTrekIds` mirror, which is idempotent by
   *      definition, so the mirror cannot accumulate duplicates either.
   *
   * `upsertedCount` tells the caller whether this call was the one that created
   * the like, which is what lets the counter be `$inc`-ed exactly once.
   */
  async likeTrek(userId: string, trekId: string): Promise<{ trekId: string; created: boolean }> {
    const id = this.requireTrekId(trekId);
    const objectId = this.toObjectId(userId);

    const result = await this.interactionModel
      .updateOne(
        { userId: objectId, trekId: id, type: 'like' },
        { $setOnInsert: { interactedAt: new Date(), ratingValue: null } },
        { upsert: true, setDefaultsOnInsert: true }
      )
      .exec();

    await this.userModel
      .updateOne({ _id: objectId }, { $addToSet: { likedTrekIds: id } })
      .exec();

    this.cache.invalidate(CacheTag.LIKES, `user:${userId}`);
    return { trekId: id, created: (result.upsertedCount ?? 0) > 0 };
  }

  /**
   * Remove a like. Also idempotent: unliking something never liked leaves the
   * user unliked, which is the state the caller asked for, so it is a success
   * rather than an error. `deletedCount` reports whether anything changed, so
   * the counter is only decremented when a like was genuinely removed.
   */
  async unlikeTrek(userId: string, trekId: string): Promise<{ trekId: string; removed: boolean }> {
    const id = this.requireTrekId(trekId);
    const objectId = this.toObjectId(userId);

    const result = await this.interactionModel
      .deleteOne({ userId: objectId, trekId: id, type: 'like' })
      .exec();

    // Pulled unconditionally: if the interaction was already gone, the mirror
    // may still hold a stale entry, and removing it is the correct repair.
    await this.userModel.updateOne({ _id: objectId }, { $pull: { likedTrekIds: id } }).exec();

    this.cache.invalidate(CacheTag.LIKES, `user:${userId}`);
    return { trekId: id, removed: (result.deletedCount ?? 0) > 0 };
  }

  /** Validate and normalise a trek id coming off the wire. */
  private requireTrekId(trekId: unknown): string {
    const id = typeof trekId === 'string' ? trekId.trim() : '';
    if (!id) throw new BadRequestException('trekId is required');
    return id;
  }

  /** Convert a user id to an ObjectId, rejecting malformed input up front. */
  private toObjectId(userId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    return new Types.ObjectId(userId);
  }

  async getUserLikes(userId: string): Promise<UserInteractionDocument[]> {
    return this.interactionModel
      .find({ userId: new Types.ObjectId(userId), type: 'like' })
      .sort({ interactedAt: -1 })
      .exec();
  }

  async isTrekLikedByUser(userId: string, trekId: string): Promise<boolean> {
    const like = await this.interactionModel
      .findOne({ userId: new Types.ObjectId(userId), trekId, type: 'like' })
      .exec();
    return !!like;
  }

  async getTrekLikeCount(trekId: string): Promise<number> {
    return this.interactionModel.countDocuments({ trekId, type: 'like' }).exec();
  }

  /**
   * Leaderboard aggregation over the likes collection. `$group` + `$sort` are
   * both served by the `{trekId: 1, type: 1}` index.
   */
  async getTopLikedTreks(limit: number = 3): Promise<{ trekId: string; count: number }[]> {
    const result = await this.interactionModel.aggregate([
      { $match: { type: 'like' } },
      { $group: { _id: '$trekId', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
      { $project: { trekId: '$_id', count: 1, _id: 0 } },
    ]).exec();
    return result.map((r: any) => ({ trekId: r.trekId, count: r.count }));
  }

  /**
   * Live like count for **every** trek in the catalogue, in a single round trip.
   * The feed renders counts per card, so per-card requests would mean one query
   * per visible trek.
   *
   * Treks nobody has liked are returned explicitly as 0 rather than omitted.
   * A sparse map was the root of the "count resets to 1 on like, 0 on unlike"
   * bug: a missing key made the client fall back to the catalogue's fabricated
   * seed number (e.g. 312), and the first optimistic increment then replaced
   * that seed with the real aggregate (0 + 1 = 1). Every trek having a real
   * count means the UI never has a fake number to fall back to.
   */
  async getAllLikeCounts(): Promise<Record<string, number>> {
    return this.cache.wrap(
      'likes:counts',
      CACHE_TTL.LIKE_COUNTS,
      [CacheTag.LIKES],
      async () => {
        const result = await this.interactionModel.aggregate([
          { $match: { type: 'like' } },
          { $group: { _id: '$trekId', count: { $sum: 1 } } },
        ]).exec();

        // Baseline of zeroes for the whole catalogue, then overlay real counts.
        const counts: Record<string, number> = {};
        for (const trek of TREK_METADATA) counts[trek.trekId] = 0;
        for (const row of result as { _id: string; count: number }[]) {
          counts[row._id] = row.count;
        }
        return counts;
      }
    );
  }

  /**
   * Rebuild every user's `likedTrekIds` mirror from the interaction collection.
   * Runs at boot so a write that died between the interaction insert and the
   * mirror update cannot leave a user's likes permanently out of step.
   */
  async syncLikedTrekIds(): Promise<number> {
    const grouped = await this.interactionModel.aggregate([
      { $match: { type: 'like' } },
      { $group: { _id: '$userId', trekIds: { $addToSet: '$trekId' } } },
    ]).exec();

    const byUser = new Map<string, string[]>();
    for (const row of grouped as { _id: Types.ObjectId; trekIds: string[] }[]) {
      byUser.set(row._id.toString(), row.trekIds);
    }

    const users = await this.userModel.find().select('_id likedTrekIds').lean().exec();
    const operations = users
      .map((u: any) => {
        const expected = (byUser.get(u._id.toString()) ?? []).slice().sort();
        const actual = (u.likedTrekIds ?? []).slice().sort();
        const same =
          expected.length === actual.length && expected.every((id, i) => id === actual[i]);
        return same
          ? null
          : {
              updateOne: {
                filter: { _id: u._id },
                update: { $set: { likedTrekIds: expected } },
              },
            };
      })
      .filter(Boolean) as any[];

    if (operations.length > 0) {
      await this.userModel.bulkWrite(operations, { ordered: false });
    }
    return operations.length;
  }

  // ─── KNN support: fetch all profiles + interactions for the engine ─────────

  /** Neighbour corpus. `ageGroup` is re-derived from DOB so the vectors age. */
  async getAllProfiles(): Promise<{ userId: string; profile: UserProfile; preferences: UserPreferences }[]> {
    // `.lean()` is what makes the embedded `profile` a plain object; spreading
    // a Mongoose subdocument yields its internals, not its fields.
    const users = await this.userModel
      .find({ isOnboarded: true })
      .select('profile preferences dateOfBirth')
      .lean()
      .exec();
    return users.map((u: any) => ({
      userId: u._id.toString(),
      profile: {
        ...(u.profile ?? {}),
        ageGroup: ageGroupFromDob(u.dateOfBirth, u.profile?.ageGroup ?? DEFAULT_AGE_BRACKET),
      },
      preferences: u.preferences,
    }));
  }

  /**
   * Every *like* across all users — the collaborative layer's raw matrix.
   *
   * Scoped to likes at the query level rather than in the caller. Passive
   * `view` and `dismiss` rows now live in the same collection and vastly
   * outnumber likes; loading them here would pull the whole signal history into
   * memory on every feed build for a consumer that discards them anyway.
   */
  async getAllInteractions(): Promise<{ userId: string; trekId: string; type: string; ratingValue: number | null }[]> {
    const interactions = await this.interactionModel.find({ type: 'like' }).exec();
    return interactions.map((i: any) => ({
      userId: i.userId.toString(),
      trekId: i.trekId,
      type: i.type,
      ratingValue: i.ratingValue,
    }));
  }

  /**
   * One user's passive signals — how long they lingered on each card and what
   * they scrolled straight past. Only the active user's rows, because these
   * shape *their* feed and never anyone else's.
   */
  async getUserSignals(
    userId: string
  ): Promise<{ trekId: string; type: 'view' | 'dismiss'; count: number; dwellMs: number }[]> {
    const rows = await this.interactionModel
      .find({ userId: this.toObjectId(userId), type: { $in: ['view', 'dismiss'] } })
      .exec();
    return rows.map((r: any) => ({
      trekId: r.trekId,
      type: r.type,
      count: r.count ?? 0,
      dwellMs: r.dwellMs ?? 0,
    }));
  }

  /**
   * Record a batch of passive signals.
   *
   * Accumulating rather than inserting: the compound unique index is
   * `{userId, trekId, type}`, so a second view of the same card increments the
   * existing row. Batched because these fire constantly while scrolling — one
   * request per card would be an unusable amount of traffic.
   */
  async recordSignals(
    userId: string,
    signals: { trekId: string; type: 'view' | 'dismiss'; dwellMs?: number }[]
  ): Promise<{ recorded: number }> {
    const objectId = this.toObjectId(userId);
    const operations = signals
      .filter(s => s && typeof s.trekId === 'string' && s.trekId.trim().length > 0)
      .map(s => ({
        updateOne: {
          filter: { userId: objectId, trekId: s.trekId.trim(), type: s.type },
          update: {
            $inc: {
              count: 1,
              dwellMs: Math.max(0, Math.min(MAX_SIGNAL_DWELL_MS, Math.round(s.dwellMs ?? 0))),
            },
            $setOnInsert: { interactedAt: new Date(), ratingValue: null },
          },
          upsert: true,
        },
      }));

    if (operations.length === 0) return { recorded: 0 };
    await this.interactionModel.bulkWrite(operations, { ordered: false });
    this.cache.invalidate(CacheTag.LIKES, `user:${userId}`);
    return { recorded: operations.length };
  }
}
