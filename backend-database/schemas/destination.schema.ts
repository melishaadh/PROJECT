import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * A trekking destination as persisted in MongoDB.
 *
 * Every attribute the recommendation engine, the collaborative-filtering layer
 * and the Explore trending leaderboard read is stored here — price, duration,
 * difficulty, altitude, location and the live like count — so the collection is
 * a complete record rather than a name/altitude stub. `DestinationsService`
 * seeds all 30 official routes on boot, so this collection is never empty.
 */
@Schema({ timestamps: true, collection: 'destinations' })
export class Destination extends Document {
  @Prop({ required: true, unique: true, trim: true })
  trekId!: string;

  /** Short display name, e.g. "Classic ABC". */
  @Prop({ required: true, trim: true })
  name!: string;

  /** The trek family, e.g. "Annapurna Base Camp Trek". */
  @Prop({ trim: true, default: '' })
  parentName!: string;

  /** The specific variant, e.g. "ABC via Ghandruk". */
  @Prop({ trim: true, default: '' })
  childRoute!: string;

  /** Himalayan region, e.g. "Everest". */
  @Prop({ trim: true, default: '' })
  region!: string;

  /** Human-readable location line, e.g. "Khumbu, Solukhumbu". */
  @Prop({ trim: true, default: '' })
  location!: string;

  /** Maximum altitude in metres. The safety matrix reads this. */
  @Prop({ required: true })
  altitude!: number;

  /** Alias of `altitude`, kept explicit so queries read naturally. */
  @Prop({ required: true })
  maxAltitude!: number;

  @Prop({ required: true, enum: ['Easy', 'Moderate', 'Hard'], default: 'Moderate' })
  difficulty!: string;

  @Prop({ required: true, default: 0 })
  durationDays!: number;

  @Prop({ required: true, default: 0 })
  priceNPR!: number;

  @Prop({ required: true, enum: ['budget', 'mid', 'premium'], default: 'mid' })
  priceTier!: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];

  /**
   * Live like count, mirrored from the `userinteractions` collection on every
   * like/unlike. Kept denormalised here so the trending leaderboard and the
   * popularity layer can read it without an aggregation per request.
   *
   * Seeded at exactly 0 and only ever moved by a real user's like. There is no
   * companion "seed popularity" field: the leaderboard is strictly organic, so
   * a fresh database ranks every route equally until somebody likes one.
   */
  @Prop({ default: 0, min: 0 })
  likes!: number;

  /** The "ideal trekker" vector this route is labelled with in the KNN corpus. */
  @Prop({
    type: {
      ageGroup: { type: Number, default: 1 },
      experienceLevel: { type: Number, default: 1 },
      cardioFlag: { type: Number, default: 1 },
      jointFlag: { type: Number, default: 1 },
      altitudeHistory: { type: Number, default: 1 },
    },
    _id: false,
  })
  knnProfile!: {
    ageGroup: number;
    experienceLevel: number;
    cardioFlag: number;
    jointFlag: number;
    altitudeHistory: number;
  };

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const DestinationSchema = SchemaFactory.createForClass(Destination);

// `trekId` already carries a unique index via its @Prop, so it is not repeated
// here — declaring it twice makes Mongoose warn about a duplicate index.

/**
 * Trending leaderboard. `trekId` is part of the key so the sort is fully
 * covered by the index and stays deterministic when several routes tie on 0
 * likes — which, on a freshly seeded database, is all of them.
 */
DestinationSchema.index({ likes: -1, trekId: 1 });

/** Regional feeds — the behavioural layer surfaces "more from this region". */
DestinationSchema.index({ region: 1, likes: -1 });

/** Ascending/descending price sorts for the "cheap"/"expensive" queries. */
DestinationSchema.index({ priceNPR: 1 });

/** Exact-duration lookups from the Explore search and the duration filter. */
DestinationSchema.index({ durationDays: 1, priceNPR: 1 });

DestinationSchema.index({ altitude: 1 });
DestinationSchema.index({ difficulty: 1, priceTier: 1 });

/**
 * Free-text search across the human-readable fields. Weighted so a hit on the
 * route's own name outranks one buried in the keyword list, which is what makes
 * an exact-title query rank the exact title first.
 */
DestinationSchema.index(
  { name: 'text', parentName: 'text', childRoute: 'text', location: 'text', keywords: 'text' },
  { weights: { name: 10, parentName: 6, childRoute: 6, location: 3, keywords: 1 }, name: 'destination_text' }
);

export type DestinationDocument = Destination & Document;
