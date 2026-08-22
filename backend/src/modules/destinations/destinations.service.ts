import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Destination, DestinationDocument } from '@db/schemas/destination.schema';
import { TREK_METADATA, TrekMeta } from '@/data/trek-metadata';
import { CACHE_TTL, CacheService, CacheTag } from '@/common/cache.service';

export interface DestinationQuery {
  minAltitude?: number;
  maxAltitude?: number;
  difficulty?: string;
  priceTier?: string;
  search?: string;
}

/** Allow-lists for the enum query parameters, so nothing arbitrary reaches Mongo. */
const DIFFICULTIES = new Set(['Easy', 'Moderate', 'Hard']);
const PRICE_TIERS = new Set(['budget', 'mid', 'premium']);

/**
 * Fields excluded from every catalogue read.
 *
 * `embedding` is a leftover 384-dimension vector from a semantic-search
 * experiment that no longer exists in the codebase. It is not declared on the
 * schema, nothing reads it, and it is roughly an order of magnitude larger than
 * the rest of the document — so shipping it on the app's hottest query (the
 * whole catalogue, on every feed request) was pure waste.
 *
 * Projected away rather than deleted: it costs nothing to leave the data in
 * place, and dropping a regenerable-but-expensive field outright would be an
 * irreversible call to make on somebody else's database.
 */
const CATALOGUE_PROJECTION = { embedding: 0, __v: 0 } as const;

/** Neutralise regex metacharacters so user text is matched literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The document shape the catalogue seeds for one trek. */
function documentFor(trek: TrekMeta): Partial<Destination> {
  return {
    trekId: trek.trekId,
    name: trek.name,
    parentName: trek.parentName,
    childRoute: trek.childRoute,
    region: trek.region,
    location: trek.location,
    altitude: trek.maxAltitude,
    maxAltitude: trek.maxAltitude,
    difficulty: trek.difficulty,
    durationDays: trek.durationDays,
    priceNPR: trek.priceNPR,
    priceTier: trek.priceTier,
    keywords: trek.keywords,
    knnProfile: trek.knnProfile,
  };
}

@Injectable()
export class DestinationsService implements OnModuleInit {
  private readonly logger = new Logger(DestinationsService.name);

  constructor(
    @InjectModel(Destination.name) private destinationModel: Model<DestinationDocument>,
    private readonly cache: CacheService,
  ) {}

  /**
   * Guarantee the destinations collection is never empty.
   *
   * Runs on every boot and upserts all 30 official routes with their complete
   * attributes. The live `likes` counter is deliberately excluded from the
   * update set, so re-seeding refreshes the catalogue metadata without ever
   * resetting the popularity that real user likes have accumulated.
   */
  async onModuleInit(): Promise<void> {
    try {
      const { seeded, total } = await this.seedCatalogue();
      const cleaned = await this.removeLegacySeedLikes();
      this.logger.log(`Destination catalogue ready — ${total} routes (${seeded} written)`);
      if (cleaned > 0) {
        this.logger.log(`Removed fabricated seed likes from ${cleaned} destination(s)`);
      }
    } catch (error) {
      // A seeding failure must not stop the API from booting; the engine falls
      // back to the in-process catalogue if the collection is unreachable.
      this.logger.error(`Destination seeding failed: ${(error as Error).message}`);
    }
  }

  /**
   * Idempotent catalogue seed. Safe to call repeatedly: existing documents are
   * updated in place, missing ones are inserted, and `likes` is only initialised
   * on insert.
   *
   * A newly seeded destination starts at **exactly zero likes**. Nothing in the
   * catalogue carries a fabricated head start, so the leaderboard can only ever
   * reflect real user activity.
   */
  async seedCatalogue(): Promise<{ seeded: number; total: number }> {
    const operations = TREK_METADATA.map(trek => ({
      updateOne: {
        filter: { trekId: trek.trekId },
        update: {
          $set: documentFor(trek),
          // Only applied when the document is created, so real likes survive a
          // re-seed while a brand-new route still starts from zero.
          $setOnInsert: { likes: 0 },
        },
        upsert: true,
      },
    }));

    const result = await this.destinationModel.bulkWrite(operations, { ordered: false });
    const seeded = (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
    const total = await this.destinationModel.countDocuments().exec();
    this.cache.invalidate(CacheTag.DESTINATIONS);
    return { seeded, total };
  }

  /**
   * Strip the legacy `seedLikes` field from documents written by an older build.
   *
   * That field held a fabricated popularity number (Classic ABC shipped with
   * 312 likes nobody had given it) which the leaderboard used as a tiebreaker.
   * It is gone from the schema and from the ranking, but it survives on any
   * document an earlier version wrote, so it has to be actively removed rather
   * than merely ignored — a stale 312 sitting in the collection is exactly the
   * fake engagement the "zero seed likes" requirement is about.
   *
   * Issued through the **raw driver** deliberately. Mongoose applies `strict`
   * mode to update operators and silently drops any path the schema does not
   * declare — so `$unset: { seedLikes: '' }` through the model is a no-op that
   * reports success, which is precisely how this went unnoticed. Removing a
   * field always requires going under Mongoose to do it.
   *
   * @returns how many documents were cleaned.
   */
  async removeLegacySeedLikes(): Promise<number> {
    const result = await this.destinationModel.collection.updateMany(
      { seedLikes: { $exists: true } },
      { $unset: { seedLikes: '' } }
    );
    if (result.modifiedCount > 0) this.cache.invalidate(CacheTag.DESTINATIONS);
    return result.modifiedCount ?? 0;
  }

  /**
   * Rebuild the denormalised `likes` counter for every destination from the
   * authoritative like counts. Called after the interaction collection changes
   * in bulk, and by the recommendation engine when it detects drift.
   */
  async syncLikeCounts(counts: Record<string, number>): Promise<void> {
    const operations = TREK_METADATA.map(trek => ({
      updateOne: {
        filter: { trekId: trek.trekId },
        update: { $set: { likes: Math.max(0, counts[trek.trekId] ?? 0) } },
      },
    }));
    if (operations.length === 0) return;
    await this.destinationModel.bulkWrite(operations, { ordered: false });
    this.cache.invalidate(CacheTag.DESTINATIONS, CacheTag.LIKES);
  }

  /**
   * The whole catalogue, cached.
   *
   * This is the engine's hot path — every For You request and every trending
   * lookup starts here — and the collection only changes on a re-seed or a like
   * mirror, both of which invalidate the entry. Reading it from memory is what
   * keeps a feed refresh instantaneous instead of paying a full collection scan
   * per request.
   */
  async catalogue(): Promise<DestinationDocument[]> {
    return this.cache.wrap(
      'destinations:all',
      CACHE_TTL.CATALOGUE,
      [CacheTag.DESTINATIONS, CacheTag.LIKES],
      () =>
        this.destinationModel
          .find({}, CATALOGUE_PROJECTION)
          .sort({ likes: -1, trekId: 1 })
          .exec()
    );
  }

  /**
   * The catalogue with a set of routes removed **at the query level**.
   *
   * This is how a user's completed treks leave the recommendation pipeline: the
   * engine asks Mongo for the candidate set with `$nin` rather than fetching all
   * 30 routes and dropping some afterwards, so a completed trek is never scored,
   * never ranked, and cannot be reintroduced by any padding or backfill stage
   * further down. Exclusion is by exact `trekId`, which is what keeps it a
   * *route*-level rule: completing "Gokyo Lakes & EBC" removes that id and
   * nothing else, so every sibling route under the same parent family stays in
   * the candidate set until it too has been walked.
   *
   * Cached per exclusion set, under the same `DESTINATIONS`/`LIKES` tags as the
   * unfiltered read, so a re-seed or a like mirror invalidates these entries
   * alongside it. Users converge on the same handful of completed-id sets, so
   * the key space stays small; an empty set reuses the shared entry outright.
   */
  async catalogueExcluding(trekIds: readonly string[]): Promise<DestinationDocument[]> {
    const excluded = Array.from(new Set(trekIds.filter(id => typeof id === 'string' && id)));
    if (excluded.length === 0) return this.catalogue();

    // Sorted, so two callers holding the same ids in a different order share one
    // entry rather than computing the same query twice under different keys.
    const key = `destinations:excluding:${[...excluded].sort().join(',')}`;
    return this.cache.wrap(
      key,
      CACHE_TTL.CATALOGUE,
      [CacheTag.DESTINATIONS, CacheTag.LIKES],
      () =>
        this.destinationModel
          .find({ trekId: { $nin: excluded } }, CATALOGUE_PROJECTION)
          .sort({ likes: -1, trekId: 1 })
          .exec()
    );
  }

  async findAll(query?: DestinationQuery): Promise<DestinationDocument[]> {
    // An unfiltered read is the common case and has its own cache entry.
    if (!query || Object.values(query).every(v => v === undefined || v === '')) {
      return this.catalogue();
    }

    const filter: Record<string, any> = {};

    // Every bound is coerced through Number() and range-checked before it
    // reaches the query. A non-finite value is dropped rather than forwarded,
    // so an operator object smuggled in via `?minAltitude[$gt]=` becomes NaN
    // and is discarded instead of being interpreted by MongoDB.
    const min = Number(query.minAltitude);
    const max = Number(query.maxAltitude);
    if (Number.isFinite(min) || Number.isFinite(max)) {
      filter.altitude = {};
      if (Number.isFinite(min)) filter.altitude.$gte = min;
      if (Number.isFinite(max)) filter.altitude.$lte = max;
    }

    // Enum fields are matched against a known allow-list, never passed through.
    if (typeof query.difficulty === 'string' && DIFFICULTIES.has(query.difficulty)) {
      filter.difficulty = query.difficulty;
    }
    if (typeof query.priceTier === 'string' && PRICE_TIERS.has(query.priceTier)) {
      filter.priceTier = query.priceTier;
    }

    // `search` is forced to a primitive string before it is used. Express will
    // happily parse `?search[$ne]=x` into an object; handing that straight to
    // `$regex` is the classic NoSQL injection vector.
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search) {
      const escaped = escapeRegex(search).slice(0, 128);
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { parentName: { $regex: escaped, $options: 'i' } },
        { childRoute: { $regex: escaped, $options: 'i' } },
        { location: { $regex: escaped, $options: 'i' } },
        { keywords: { $regex: escaped, $options: 'i' } },
      ];
    }

    return this.destinationModel
      .find(filter, CATALOGUE_PROJECTION)
      .sort({ likes: -1, trekId: 1 })
      .exec();
  }

  async findById(trekId: string): Promise<DestinationDocument | null> {
    const id = typeof trekId === 'string' ? trekId.trim() : '';
    if (!id) return null;
    return this.destinationModel.findOne({ trekId: id }, CATALOGUE_PROJECTION).exec();
  }

  async findByIdOrThrow(trekId: string): Promise<DestinationDocument> {
    const dest = await this.findById(trekId);
    if (!dest) {
      throw new NotFoundException(`Destination with trekId ${trekId} not found`);
    }
    return dest;
  }

  async create(data: Partial<Destination>): Promise<DestinationDocument> {
    const dest = new this.destinationModel(data);
    const saved = await dest.save();
    this.cache.invalidate(CacheTag.DESTINATIONS);
    return saved;
  }

  async update(trekId: string, data: Partial<Destination>): Promise<DestinationDocument | null> {
    const updated = await this.destinationModel.findOneAndUpdate(
      { trekId },
      { $set: data },
      { new: true }
    ).exec();
    this.cache.invalidate(CacheTag.DESTINATIONS);
    return updated;
  }

  async delete(trekId: string): Promise<boolean> {
    const result = await this.destinationModel.deleteOne({ trekId }).exec();
    this.cache.invalidate(CacheTag.DESTINATIONS);
    return result.deletedCount > 0;
  }

  /**
   * Set the denormalised like counter to an authoritative value. Preferred over
   * `$inc` because the interaction collection — not this counter — is the source
   * of truth, so a dropped request can never leave the two out of step.
   *
   * Clamped at zero, so even a bad caller cannot drive the counter negative —
   * which is what keeps a leaderboard built purely from organic likes honest.
   */
  async setLikeCount(trekId: string, likes: number): Promise<DestinationDocument | null> {
    const updated = await this.destinationModel.findOneAndUpdate(
      { trekId },
      { $set: { likes: Math.max(0, Math.trunc(likes) || 0) } },
      { new: true }
    ).exec();
    this.cache.invalidate(CacheTag.DESTINATIONS, CacheTag.LIKES);
    return updated;
  }

  /** Trending leaderboard straight from the collection, ranked by real likes. */
  async getTopDestinations(limit: number = 10): Promise<DestinationDocument[]> {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 30) : 10;
    return this.cache.wrap(
      `destinations:top:${n}`,
      CACHE_TTL.TRENDING,
      [CacheTag.DESTINATIONS, CacheTag.LIKES],
      () =>
        this.destinationModel
          .find({}, CATALOGUE_PROJECTION)
          .sort({ likes: -1, trekId: 1 })
          .limit(n)
          .exec()
    );
  }

  async count(query?: DestinationQuery): Promise<number> {
    const filter: Record<string, any> = {};
    if (query?.minAltitude !== undefined || query?.maxAltitude !== undefined) {
      filter.altitude = {};
      if (query.minAltitude !== undefined) filter.altitude.$gte = query.minAltitude;
      if (query.maxAltitude !== undefined) filter.altitude.$lte = query.maxAltitude;
    }
    return this.destinationModel.countDocuments(filter).exec();
  }
}
