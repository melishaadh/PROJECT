import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * UserInteraction Schema — records user engagement with destinations.
 *
 * This is the "historical database vector" source for the KNN engine. Each
 * 'like' creates a document linking userId to trekId. The KNN engine queries
 * all interactions to find which treks the nearest-neighbour users have liked,
 * then ranks destinations by the aggregate preference signal.
 *
 * The `type` field distinguishes between 'like' (binary preference) and
 * 'rating' (1-5 scale) interactions, allowing the engine to weight ratings
 * more heavily than simple likes if desired.
 */
@Schema({ timestamps: true })
export class UserInteraction extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  trekId!: string;

  /**
   * The signal tier.
   *
   *   · `like`    — explicit positive. The strongest signal, and the only one
   *                 the user performs deliberately.
   *   · `rating`  — explicit 1-5 (reserved; no UI surfaces it yet).
   *   · `view`    — passive interest. Recorded with dwell time, because a card
   *                 held on screen for eight seconds means something a card
   *                 that flashed past does not.
   *   · `dismiss` — passive negative. A card seen repeatedly, barely, and never
   *                 engaged with. Downranks the route and its category.
   */
  @Prop({ required: true, enum: ['like', 'rating', 'view', 'dismiss'], default: 'like' })
  type!: 'like' | 'rating' | 'view' | 'dismiss';

  @Prop({ type: Number, min: 1, max: 5, default: null })
  ratingValue!: number | null;

  /**
   * How many times this signal has fired for this user/trek pair. The compound
   * unique index below means one document per pair, so repeats accumulate here
   * instead of inserting duplicates.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  count!: number;

  /**
   * Cumulative milliseconds the card was on screen, for `view` rows. Summed
   * rather than averaged so the engine can compute a mean itself and still see
   * total attention.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  dwellMs!: number;

  @Prop({ type: Date, default: Date.now })
  interactedAt!: Date;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const UserInteractionSchema = SchemaFactory.createForClass(UserInteraction);

// Compound unique index: one user can like a trek once
UserInteractionSchema.index(
  { userId: 1, trekId: 1, type: 1 },
  { unique: true }
);

// Index for aggregating popular treks
UserInteractionSchema.index({ trekId: 1, type: 1 });

// Index for fetching a user's interactions sorted by date
UserInteractionSchema.index({ userId: 1, interactedAt: -1 });

export type UserInteractionDocument = UserInteraction & Document;
