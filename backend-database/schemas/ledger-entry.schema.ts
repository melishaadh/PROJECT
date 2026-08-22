import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * One logged expense inside a group's shared ledger — "who paid for what,
 * how much" for the trip/hangout costs that get split informally between
 * members rather than tracked per-message. Amounts are entered by any
 * member on anyone's behalf (whoever actually paid at the till isn't
 * necessarily the one with a phone out), so `addedBy` and `payerId` are
 * deliberately separate fields.
 *
 * `roomId`/`payerId`/`addedBy` use `MongooseSchema.Types.ObjectId` — not the
 * `Types.ObjectId` (BSON value) class — for the same reason documented on
 * `message.schema.ts`: the value class registers the field as `Mixed` and
 * silently breaks string-filtered queries.
 */
@Schema({ timestamps: true })
export class LedgerEntry extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'ChatRoom' })
  roomId!: Types.ObjectId;

  /** The member this expense is attributed to — who actually paid. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User' })
  payerId!: Types.ObjectId;

  /** Whoever logged the entry — may or may not be the same person as `payerId`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User' })
  addedBy!: Types.ObjectId;

  @Prop({ required: true, min: 0.01, max: 10_000_000 })
  amount!: number;

  @Prop({ required: true, trim: true, maxlength: 200 })
  remark!: string;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

/** A room's ledger is always read as one page, newest first. */
LedgerEntrySchema.index({ roomId: 1, createdAt: -1 });

export type LedgerEntryDocument = LedgerEntry & Document;
